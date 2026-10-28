"use client";

import { publicClient } from "./supabase";

export const OPERATIONS_TOPIC = "mkss:operations";
export type LiveResource = "visits" | "attendance" | "drivers" | "registrations" | "reference" | "contractors";
type Listener = (resource: LiveResource | null) => void;
type Entry = { channel: ReturnType<ReturnType<typeof publicClient>["channel"]>; listeners: Set<Listener> };
const channels = new Map<string, Entry>();

// Mounted screens in one tab share a socket channel. Events contain no business data;
// consumers fetch fresh records through their usual authorized API endpoints.
export function subscribeToLiveEvents(topic: string, listener: Listener) {
  let entry = channels.get(topic);
  if (!entry) {
    const client = publicClient();
    const channel = client.channel(topic, { config: { private: true } });
    entry = { channel, listeners: new Set() };
    channels.set(topic, entry);
    const current = entry;
    channel.on("broadcast", { event: "changed" }, ({ payload }) => {
      const resource = payload?.resource as LiveResource | undefined;
      if (resource) current.listeners.forEach(callback => callback(resource));
    });
    void client.auth.getSession().then(async ({ data }) => {
      if (!data.session || channels.get(topic) !== current) return;
      await client.realtime.setAuth(data.session.access_token);
      if (channels.get(topic) !== current) return;
      channel.subscribe(status => {
        // Reconcile after the initial join and after a socket reconnect.
        if (status === "SUBSCRIBED") current.listeners.forEach(callback => callback(null));
      });
    }).catch(() => { /* The 60-second fallback remains available during connection failures. */ });
  }
  entry.listeners.add(listener);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && channels.get(topic) === current) {
      channels.delete(topic);
      void publicClient().removeChannel(current.channel);
    }
  };
}
