import { api } from "@/lib/client-api";

export function supportsPhonePush() {
  return typeof window !== "undefined" && window.isSecureContext &&
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushKeyBytes(key: string) {
  const encoded = key.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export async function removeAdminPushOnSignOut() {
  if (!supportsPhonePush()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    try {
      await api("admin-push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    } finally {
      await subscription.unsubscribe();
    }
  } catch (error) {
    console.error("Could not remove phone notification subscription", error);
  }
}
