"use client";

import { useEffect } from "react";
import { OPERATIONS_TOPIC, subscribeToLiveEvents, type LiveResource } from "./live-events";

export function useLiveRefresh(refresh: () => Promise<unknown>, {
  resources, enabled = true, topic = OPERATIONS_TOPIC, intervalMs = 60_000, resetKey = 0,
}: { resources: readonly LiveResource[]; enabled?: boolean; topic?: string; intervalMs?: number; resetKey?: number }) {
  const resourceKey = resources.join(",");
  useEffect(() => {
    if (!enabled) return;
    return startLiveRefresh(refresh, resourceKey.split(",") as LiveResource[], topic, intervalMs);
  }, [refresh, enabled, topic, intervalMs, resourceKey, resetKey]);
}

export function startLiveRefresh(refresh: () => Promise<unknown>, resources: readonly LiveResource[], topic = OPERATIONS_TOPIC, intervalMs = 60_000) {
    const interested = new Set(resources);
    let stopped = false, inFlight = false, queued = false, lastStarted = 0;
    let delayed: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      queued = true;
      if (stopped || delayed || inFlight || document.hidden) return;
      // Batch bursts and cap reloads at one per two seconds while events stream.
      delayed = setTimeout(() => { delayed = undefined; void run(); }, Math.max(250, 2000 - (Date.now() - lastStarted)));
    };
    const run = async () => {
      if (stopped || document.hidden) return;
      if (inFlight) { queued = true; return; }
      inFlight = true; queued = false; lastStarted = Date.now();
      try { await refresh(); }
      catch { /* Each screen owns its fetch error display. */ }
      finally { inFlight = false; if (queued && !stopped) schedule(); }
    };
    const unsubscribe = subscribeToLiveEvents(topic, resource => {
      if (resource === null || interested.has(resource)) schedule();
    });
    void run();
    const fallback = setInterval(schedule, intervalMs);
    const onVisible = () => { if (!document.hidden) schedule(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true; clearInterval(fallback); clearTimeout(delayed); unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
}
