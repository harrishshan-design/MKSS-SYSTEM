"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Pencil, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";

type Request = {
  id: string;
  email: string;
  full_name: string;
  identity_reference: string;
  phone: string;
  requested_company: string;
  has_driving_licence: boolean | null;
  trip_type: "Hantar Barang" | "Ambil Barang" | null;
  requested_lorry: string | null;
  requested_vehicle_type: string | null;
  created_at: string;
};

export default function RegistrationRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState("");
  const [draft, setDraft] = useState<Request | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try { setRequests(await api<Request[]>("signup/requests")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(draft.id); setError(""); setMessage("");
    try {
      await api("signup/requests", { method: "PATCH", body: JSON.stringify({
        id: draft.id, email: draft.email, full_name: draft.full_name,
        identity_reference: draft.identity_reference, phone: draft.phone,
        requested_company: draft.requested_company, requested_lorry: draft.requested_lorry,
        has_driving_licence: draft.has_driving_licence, trip_type: draft.trip_type,
      }) });
      setDraft(null);
      setMessage("Registration details saved.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(""); }
  }

  async function approve(request: Request) {
    setSaving(request.id); setError(""); setMessage("");
    try {
      await api("signup/approve", { method: "POST", body: JSON.stringify({ request_id: request.id }) });
      setMessage(`${request.full_name} can now sign in and scan the daily QR with vehicle ${request.requested_lorry}.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(""); }
  }

  return <>
    <div className="page-header"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Driver registrations</h1><p>Review the submitted details and approve the driver and vehicle.</p></div><button className="button secondary" onClick={refresh} disabled={busy}><RefreshCw size={16}/> Refresh</button></div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success"><Check size={17}/>{message}</div>}
    {busy && <div className="panel pad center"><Loader2 className="spin" size={22}/></div>}
    {!busy && requests.length === 0 && <div className="panel pad center"><h2>No pending registrations</h2><p className="muted">New driver requests will appear here.</p></div>}
    <div className="registration-list">{requests.map(request => <div className="panel registration-card" key={request.id}>
      <div className="registration-summary"><div><span className="eyebrow">PENDING DRIVER</span><h2>{request.full_name}</h2><p>{request.email} · {request.phone}</p><p><strong>{request.requested_company}</strong> · {request.trip_type || "Type not supplied"}</p><p>IC: {request.identity_reference || "Not supplied"} · Driving licence: {request.has_driving_licence === null ? "Not answered" : request.has_driving_licence ? "Yes" : "No"}</p><p>Vehicle number: {request.requested_lorry || "Not supplied"}</p></div><span className="muted">{siteDateTime(request.created_at)}</span></div>
      {draft?.id === request.id ? <form className="registration-edit" onSubmit={save}>
        <div className="registration-edit-grid">
          <label>Name<input required minLength={2} maxLength={120} value={draft.full_name} onChange={event => setDraft({ ...draft, full_name: event.target.value })}/></label>
          <label>Email address<input required type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })}/></label>
          <label>IC number<input required minLength={6} maxLength={30} value={draft.identity_reference || ""} onChange={event => setDraft({ ...draft, identity_reference: event.target.value })}/></label>
          <label>Phone number<input required type="tel" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })}/></label>
          <label>Company name<input required maxLength={120} value={draft.requested_company} onChange={event => setDraft({ ...draft, requested_company: event.target.value })}/></label>
          <label>Vehicle number<input required minLength={2} maxLength={40} value={draft.requested_lorry || ""} onChange={event => setDraft({ ...draft, requested_lorry: event.target.value })}/></label>
          <label>Driving licence<select required value={draft.has_driving_licence === null ? "" : draft.has_driving_licence ? "yes" : "no"} onChange={event => setDraft({ ...draft, has_driving_licence: event.target.value === "" ? null : event.target.value === "yes" })}><option value="">Select Yes or No</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>Type<select required value={draft.trip_type || ""} onChange={event => setDraft({ ...draft, trip_type: event.target.value as Request["trip_type"] })}><option value="">Select type</option><option value="Hantar Barang">Hantar Barang</option><option value="Ambil Barang">Ambil Barang</option></select></label>
        </div>
        <div className="registration-controls"><button className="button primary" disabled={!!saving}>{saving === request.id && <Loader2 className="spin" size={16}/>} Save corrections</button><button type="button" className="button secondary" onClick={() => setDraft(null)}>Cancel</button></div>
      </form> : <div className="registration-controls"><button className="button secondary" disabled={!!saving} onClick={() => { setDraft(request); setError(""); }}><Pencil size={16}/> Edit details</button><button className="button primary" disabled={!!saving || request.has_driving_licence === null || !request.trip_type || !request.requested_lorry} onClick={() => approve(request)}>{saving === request.id ? <Loader2 className="spin" size={16}/> : <ArrowRight size={16}/>} Approve driver</button></div>}
      {(request.has_driving_licence === null || !request.trip_type || !request.requested_lorry) && <p className="registration-help">Add the vehicle number, driving licence answer, and type before approval.</p>}
      <p className="registration-help">Approval links the driver to this vehicle for daily QR check-in.</p>
    </div>)}</div>
  </>;
}
