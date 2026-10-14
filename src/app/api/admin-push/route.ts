import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { pushPublicKey } from "@/lib/admin-push";
import { adminClient } from "@/lib/supabase";

const endpoint = z.url().max(2048).refine(value => new URL(value).protocol === "https:", "HTTPS push endpoint required");
const subscription = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  }),
});

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    return NextResponse.json({ publicKey: pushPublicKey() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    if (!pushPublicKey() || !process.env.WEB_PUSH_PRIVATE_KEY) throw new ApiError(503, "Phone notifications are not configured");
    const body = subscription.parse(await json(req));
    const { error } = await adminClient().from("admin_push_subscriptions").upsert({
      admin_id: who.id, endpoint: body.endpoint, p256dh: body.keys.p256dh,
      auth: body.keys.auth, updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return NextResponse.json({ enabled: true });
  } catch (error) { return fail(error); }
}

export async function DELETE(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ endpoint }).parse(await json(req));
    const { error } = await adminClient().from("admin_push_subscriptions").delete()
      .eq("admin_id", who.id).eq("endpoint", body.endpoint);
    if (error) throw error;
    return NextResponse.json({ enabled: false });
  } catch (error) { return fail(error); }
}
