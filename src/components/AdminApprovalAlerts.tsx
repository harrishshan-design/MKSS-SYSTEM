"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";

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
  const previous = useRef<Summary | null>(null);

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

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshKey]);

  function review() {
    setOpen(false);
    setNewRequest(false);
    onReview();
  }

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
    </div>}
    {newRequest && !open && <div className="approval-toast" role="status">
      <Bell size={18}/><span>New driver registration needs approval.</span>
      <button type="button" onClick={review}>Review</button>
      <button className="icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNewRequest(false)}><X size={16}/></button>
    </div>}
  </div>;
}
