"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2, Smartphone, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";
import { pushKeyBytes, supportsPhonePush } from "@/lib/admin-push-client";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type PendingRequest = {
  id: string;
  full_name: string;
  requested_lorry: string | null;
  created_at: string;
};
type Summary = { count: number; requests: PendingRequest[] };

export default function AdminApprovalAlerts({ onReview, onCountChange, refreshKey }: {
  onReview: () => void;
  onCountChange: (count: number) => void;
  refreshKey: number;
}) {
  const [summary, setSummary] = useState<Summary>({ count: 0, requests: [] });
  const [open, setOpen] = useState(false);
  const [newRequest, setNewRequest] = useState(false);
  const [error, setError] = useState(false);
  const [pushKey, setPushKey] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushEndpoint, setPushEndpoint] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");
  const previous = useRef<Summary | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const config = await api<{ publicKey: string | null }>("admin-push");
        if (!mounted) return;
        setPushKey(config.publicKey);
        if (!supportsPhonePush() || Notification.permission !== "granted") return;
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription || !mounted) return;
        await api("admin-push", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
        if (mounted) { setPushEnabled(true); setPushEndpoint(subscription.endpoint); }
      } catch {
        if (mounted) setPushMessage("Phone alerts could not be checked. Try again shortly.");
      }
    })();
    return () => { mounted = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api<Summary>("admin-notifications");
      if (previous.current && (next.count > previous.current.count || next.count === previous.current.count && next.requests.some(request =>
        !previous.current?.requests.some(existing => existing.id === request.id)))) {
        setNewRequest(true);
      }
      previous.current = next;
      setSummary(next);
      onCountChange(next.count);
      setError(false);
    } catch {
      setError(true);
    }
  }, [onCountChange]);

  useLiveRefresh(refresh, { resources: ["registrations"], resetKey: refreshKey });

  function review() {
    setOpen(false);
    setNewRequest(false);
    onReview();
  }

  async function enablePush() {
    if (!supportsPhonePush() || !pushKey) return;
    setPushBusy(true); setPushMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow MKSS notifications in your phone or browser settings.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: pushKeyBytes(pushKey).buffer as ArrayBuffer,
      });
      await api("admin-push", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      setPushEnabled(true); setPushEndpoint(subscription.endpoint);
      setPushMessage("Phone alerts are enabled for this device.");
    } catch (cause) { setPushMessage(cause instanceof Error ? cause.message : "Could not enable phone alerts."); }
    finally { setPushBusy(false); }
  }

  async function disablePush() {
    setPushBusy(true); setPushMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      let serverCleanupPending = false;
      if (subscription) {
        try { await api("admin-push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); }
        catch { serverCleanupPending = true; }
        await subscription.unsubscribe();
      }
      setPushEnabled(false); setPushEndpoint("");
      setPushMessage(serverCleanupPending ? "Phone alerts stopped here. Server cleanup will happen after a failed delivery." : "Phone alerts are off for this device.");
    } catch (cause) { setPushMessage(cause instanceof Error ? cause.message : "Could not turn off phone alerts."); }
    finally { setPushBusy(false); }
  }

  async function testPush() {
    if (!pushEndpoint) return;
    setPushBusy(true); setPushMessage("");
    try {
      await api("admin-push/test", { method: "POST", body: JSON.stringify({ endpoint: pushEndpoint }) });
      setPushMessage("Test sent. Check your phone notifications.");
    } catch (cause) { setPushMessage(cause instanceof Error ? cause.message : "Could not send test alert."); }
    finally { setPushBusy(false); }
  }

  const isIos = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches ||
    "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  return <div className="approval-alerts">
    <button className="approval-bell" type="button" aria-label={`Driver approvals: ${summary.count} pending`} aria-expanded={open} onClick={() => { setOpen(value => !value); setNewRequest(false); }}>
      <Bell size={20}/>
      {summary.count > 0 && <span className="approval-bell-count">{summary.count > 99 ? "99+" : summary.count}</span>}
    </button>
    {open && <div className="approval-popover">
      <div className="approval-popover-head"><strong>Driver approvals</strong><button className="icon-button" type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={17}/></button></div>
      {error && <p className="approval-error">Could not refresh approvals. Retrying automatically.</p>}
      {summary.count === 0 ? <p className="approval-empty">No drivers waiting for approval.</p> : <>
        <p className="approval-total">{summary.count} {summary.count === 1 ? "driver is" : "drivers are"} waiting for approval</p>
        <div className="approval-items">{summary.requests.map(request => <button className="approval-item" type="button" key={request.id} onClick={review}>
          <strong>{request.full_name}</strong><span>{request.requested_lorry || "Vehicle pending"} · {siteDateTime(request.created_at)}</span>
        </button>)}</div>
        <button className="approval-review" type="button" onClick={review}>Review registrations</button>
      </>}
      <div className="approval-push">
        <div className="approval-push-title"><Smartphone size={16}/><strong>Phone alerts</strong></div>
        {pushEnabled ? <><p>Enabled on this device, even when MKSS is closed.</p><div className="approval-push-actions"><button type="button" disabled={pushBusy} onClick={testPush}>Send test</button><button type="button" disabled={pushBusy} onClick={disablePush}>Turn off</button></div></>
          : isIos && !standalone ? <p>On iPhone, open MKSS in Safari, choose Share → Add to Home Screen, then open the MKSS icon and enable alerts.</p>
          : !supportsPhonePush() ? <p>This browser cannot receive phone push alerts. Open MKSS in a supported phone browser or installed app.</p>
          : !pushKey ? <p>Phone alerts are not configured yet.</p>
          : <><p>Receive new driver approval requests on this phone while the app is closed.</p><button type="button" className="approval-enable" disabled={pushBusy} onClick={enablePush}>{pushBusy && <Loader2 className="spin" size={14}/>} Enable phone alerts</button></>}
        {pushMessage && <p role="status" className="approval-push-message">{pushMessage}</p>}
      </div>
    </div>}
    {newRequest && !open && <div className="approval-toast" role="status">
      <Bell size={18}/><span>New driver registration needs approval.</span>
      <button type="button" onClick={review}>Review</button>
      <button className="icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNewRequest(false)}><X size={16}/></button>
    </div>}
  </div>;
}
