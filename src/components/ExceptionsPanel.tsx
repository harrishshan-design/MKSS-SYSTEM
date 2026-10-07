"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";

export type ExceptionVisit = {
  id: string; visit_code: string; status: string; company_time_in: string | null;
  last_location_at: string | null; exit_pending_at: string | null;
  lorries?: { registration_number: string } | null;
  drivers?: { full_name: string } | null;
};

export default function ExceptionsPanel({ visits, now, refresh }: { visits: ExceptionVisit[]; now: number; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<ExceptionVisit | null>(null);
  const [action, setAction] = useState<"checkout" | "correct_exit" | "correct_entry" | "cancel">("checkout");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const exceptions = visits.filter(visit => !["COMPLETED", "CANCELLED"].includes(visit.status) &&
    (visit.status === "LEAVING" || visit.company_time_in && (!visit.last_location_at || now - new Date(visit.last_location_at).getTime() > 120_000)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if ((action === "correct_exit" || action === "correct_entry") && !time) { setError("Enter the observed time for a correction."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api("correction", { method: "POST", body: JSON.stringify({
        visit_id: selected.id, action, reason,
        timestamp: time ? new Date(time).toISOString() : undefined,
      }) });
      setMessage(`${selected.visit_code} updated. The reason and actor are saved in the audit trail.`);
      setSelected(null); setReason(""); setTime(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="panel exception-panel"><div className="panel-head"><div><span className="eyebrow">NEEDS HUMAN REVIEW</span><h2>Trip exceptions</h2></div><strong>{exceptions.length}</strong></div><p>Missing GPS does not prove an exit. Confirm what happened before recording a correction.</p>{message&&<div className="notice success"><Check size={16}/>{message}</div>}{error&&!selected&&<div className="notice error">{error}</div>}
    {exceptions.length ? <div className="exception-list">{exceptions.map(visit => <div className="exception-row" key={visit.id}><div><strong>{visit.lorries?.registration_number || "Vehicle"} · {visit.visit_code}</strong><span>{visit.drivers?.full_name || "Driver"} · {visit.status === "LEAVING" ? "Exit pending" : visit.last_location_at ? `Last GPS ${siteDateTime(visit.last_location_at)}` : "No GPS received"}</span></div><button className="button secondary" onClick={() => { setSelected(visit); setAction(visit.company_time_in ? "checkout" : "correct_entry"); setReason(""); setTime(""); setError(""); }}>Review</button></div>)}</div> : <p className="muted">No open trips need review.</p>}
    {selected&&<div className="modal-backdrop"><div className="modal"><div className="modal-header"><div><span className="eyebrow">AUDITED OVERRIDE</span><h2>{selected.visit_code}</h2></div><button className="icon-button" onClick={()=>setSelected(null)}><X size={20}/></button></div><div className="notice"><AlertTriangle size={17}/> Check the gate log or physical vehicle before changing this trip.</div><form className="exception-form" onSubmit={submit}><label>Action<select value={action} onChange={event=>setAction(event.target.value as typeof action)}><option value="checkout">Confirm exit now</option><option value="correct_exit">Record observed exit time</option><option value="correct_entry">Correct gate entry time</option><option value="cancel">Cancel duplicate or invalid trip</option></select></label>{(action==="correct_exit"||action==="correct_entry")&&<label>Observed time<input required type="datetime-local" value={time} onChange={event=>setTime(event.target.value)}/></label>}<label>Reason and evidence<textarea required minLength={8} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} placeholder="e.g. Guard verified plate at exit gate at 14:32"/></label>{error&&<div className="notice error">{error}</div>}<button className="button primary full" disabled={busy}>{busy?<Loader2 size={17} className="spin"/>:<Check size={17}/>} Save audited correction</button></form></div></div>}
  </section>;
}
