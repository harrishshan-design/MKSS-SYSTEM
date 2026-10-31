import webpush from "web-push";
import { adminClient } from "@/lib/supabase";

type Subscription = { id: string; admin_id: string; endpoint: string; p256dh: string; auth: string };
type Delivery = { id: string; request_id: string; subscription_id: string; attempts: number };

export function pushPublicKey() { return process.env.WEB_PUSH_PUBLIC_KEY || null; }

function configurePush() {
  const publicKey = pushPublicKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails("https://mkss-system.vercel.app", publicKey, privateKey);
  return true;
}

function destination(subscription: Subscription) {
  return { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
}

export async function queueApprovalPush(requestId: string) {
  const db = adminClient();
  const { data: admins, error: adminError } = await db.from("users")
    .select("id").eq("role", "admin").eq("active", true);
  if (adminError) throw adminError;
  if (!admins?.length) return 0;
  const { data: subscriptions, error: subscriptionError } = await db.from("admin_push_subscriptions")
    .select("id,admin_id").in("admin_id", admins.map(admin => admin.id));
  if (subscriptionError) throw subscriptionError;
  if (!subscriptions?.length) return 0;
  const { error } = await db.from("admin_push_deliveries").upsert(subscriptions.map(subscription => ({
    request_id: requestId, subscription_id: subscription.id, status: "pending", attempts: 0, last_error: null, sent_at: null, next_attempt_at: new Date().toISOString(),
  })), { onConflict: "request_id,subscription_id" });
  if (error) throw error;
  return subscriptions.length;
}

export async function sendTestPush(adminId: string, endpoint: string) {
  if (!configurePush()) throw new Error("Phone notifications are not configured");
  const { data: subscription, error } = await adminClient().from("admin_push_subscriptions")
    .select("id,admin_id,endpoint,p256dh,auth").eq("admin_id", adminId).eq("endpoint", endpoint).maybeSingle();
  if (error || !subscription) throw new Error("This phone is not registered for admin notifications");
  await webpush.sendNotification(destination(subscription), JSON.stringify({
    title: "MKSS phone alerts are working",
    body: "You will receive a notification when a driver requests approval.",
    url: "/?section=registrations",
  }), { TTL: 60, urgency: "high", timeout: 8000 });
}

export async function processApprovalPush() {
  if (!configurePush()) return { sent: 0, failed: 0, configured: false };
  const db = adminClient();
  const { data, error } = await db.rpc("claim_admin_push_deliveries", { p_limit: 50 });
  if (error) throw error;
  const deliveries = (data || []) as Delivery[];
  if (!deliveries.length) return { sent: 0, failed: 0, configured: true };

  const [subscriptionResult, requestResult] = await Promise.all([
    db.from("admin_push_subscriptions").select("id,admin_id,endpoint,p256dh,auth")
      .in("id", [...new Set(deliveries.map(item => item.subscription_id))]),
    db.from("driver_registration_requests").select("id,status")
      .in("id", [...new Set(deliveries.map(item => item.request_id))]),
  ]);
  if (subscriptionResult.error || requestResult.error) throw subscriptionResult.error || requestResult.error;
  const subscriptions = new Map((subscriptionResult.data || []).map(item => [item.id, item as Subscription]));
  const requests = new Map((requestResult.data || []).map(item => [item.id, item.status]));
  const adminIds = [...new Set([...subscriptions.values()].map(item => item.admin_id))];
  const { data: activeAdmins, error: adminsError } = adminIds.length
    ? await db.from("users").select("id").in("id", adminIds).eq("role", "admin").eq("active", true)
    : { data: [], error: null };
  if (adminsError) throw adminsError;
  const active = new Set((activeAdmins || []).map(item => item.id));
  let sent = 0;
  let failed = 0;

  async function deliver(delivery: Delivery) {
    const subscription = subscriptions.get(delivery.subscription_id);
    if (!subscription || !active.has(subscription.admin_id) || requests.get(delivery.request_id) !== "PENDING") {
      await db.from("admin_push_deliveries").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", delivery.id);
      return;
    }
    try {
      await webpush.sendNotification(destination(subscription), JSON.stringify({
        title: "New driver approval · MKSS",
        body: "A driver has requested access. Tap to review the registration.",
        url: "/?section=registrations",
        requestId: delivery.request_id,
      }), { TTL: 86400, urgency: "high", timeout: 8000 });
      const { error: updateError } = await db.from("admin_push_deliveries").update({
        status: "sent", attempts: delivery.attempts + 1, sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), last_error: null,
      }).eq("id", delivery.id);
      if (updateError) throw updateError;
      sent++;
    } catch (cause) {
      const status = (cause as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("admin_push_subscriptions").delete().eq("id", subscription.id);
      } else {
        const attempts = delivery.attempts + 1;
        const nextAttempt = new Date(Date.now() + Math.min(60 * 2 ** (attempts - 1), 3600) * 1000).toISOString();
        await db.from("admin_push_deliveries").update({
          status: "failed", attempts, next_attempt_at: nextAttempt,
          last_error: cause instanceof Error ? cause.message.slice(0, 300) : "Push delivery failed",
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
      }
      failed++;
      console.error("Admin phone push failed", { deliveryId: delivery.id, status });
    }
  }
  for (let index = 0; index < deliveries.length; index += 5) {
    await Promise.all(deliveries.slice(index, index + 5).map(deliver));
  }
  return { sent, failed, configured: true };
}
