"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Pencil, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";

type Request = {
  id: string; email: string; full_name: string; phone: string; licence_number: string | null;
  identity_reference: string | null; requested_company: string; company_contact_person: string | null;
  company_phone: string | null; company_email: string | null; requested_lorry: string;
  requested_vehicle_type: string | null; created_at: string;
};
type DetailKey = Exclude<keyof Request, "id" | "created_at">;
const details: { title: string; fields: { key: DetailKey; label: string; required?: boolean; type?: string }[] }[] = [
  { title: "Driver", fields: [
    { key: "full_name", label: "Driver full name", required: true },
    { key: "email", label: "Email address", required: true, type: "email" },
    { key: "phone", label: "Phone number", required: true, type: "tel" },
    { key: "licence_number", label: "Driving licence number", required: true },
    { key: "identity_reference", label: "IC / passport number" },
  ] },
  { title: "Transport company", fields: [
    { key: "requested_company", label: "Transport company name", required: true },
    { key: "company_contact_person", label: "Company contact person" },
    { key: "company_phone", label: "Company phone", type: "tel" },
    { key: "company_email", label: "Company email", type: "email" },
  ] },
  { title: "Vehicle", fields: [
    { key: "requested_lorry", label: "Vehicle registration number", required: true },
    { key: "requested_vehicle_type", label: "Vehicle type", required: true },
  ] },
];

export default function RegistrationRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Request | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try { setRequests(await api<Request[]>("signup/requests")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(draft.id); setError(""); setMessage("");
    try {
      await api("signup/requests", { method: "PATCH", body: JSON.stringify(draft) });
      setEditing(null); setDraft(null);
      setMessage("Registration details saved. You can now approve the driver.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(""); }
  }

  async function approve(request: Request) {
    setSaving(request.id); setError(""); setMessage("");
    try {
      await api("signup/approve", { method: "POST", body: JSON.stringify({ request_id: request.id }) });
      setMessage(`${request.full_name} can now sign in as a driver.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(""); }
  }

  return <>
    <div className="page-header"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Driver registrations</h1><p>Check or correct the submitted details, then approve the driver.</p></div><button className="button secondary" onClick={refresh} disabled={busy}><RefreshCw size={16}/> Refresh</button></div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success"><Check size={17}/>{message}</div>}
    {busy && <div className="panel pad center"><Loader2 className="spin" size={22}/></div>}
    {!busy && requests.length === 0 && <div className="panel pad center"><h2>No pending registrations</h2><p className="muted">New driver requests will appear here.</p></div>}
    <div className="registration-list">{requests.map(request => <div className="panel registration-card" key={request.id}>
      <div className="registration-summary"><div><span className="eyebrow">PENDING DRIVER</span><h2>{request.full_name}</h2><p>{request.email} · {request.phone}</p><p><strong>{request.requested_company}</strong> · {request.requested_lorry} · {request.requested_vehicle_type || "Vehicle type not supplied"}</p><p>Licence: {request.licence_number || "Not supplied"} {request.identity_reference && `· IC / passport: ${request.identity_reference}`}</p><p>Company contact: {[request.company_contact_person, request.company_phone, request.company_email].filter(Boolean).join(" · ") || "Not supplied"}</p></div><span className="muted">{new Date(request.created_at).toLocaleDateString("en-MY")}</span></div>
      {editing === request.id && draft && <form className="registration-edit" onSubmit={save}>{details.map(group => <div className="registration-edit-group" key={group.title}><h3>{group.title}</h3><div className="registration-edit-grid">{group.fields.map(field => <label key={field.key}>{field.label}<input type={field.type || "text"} required={field.required} value={draft[field.key] || ""} onChange={event => setDraft(previous => previous ? { ...previous, [field.key]: event.target.value } : previous)}/></label>)}</div></div>)}<div className="registration-controls"><button className="button primary" disabled={!!saving}>{saving === request.id && <Loader2 className="spin" size={16}/>} Save corrections</button><button type="button" className="button secondary" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button></div></form>}
      {editing !== request.id && <div className="registration-controls"><button className="button secondary" disabled={!!saving} onClick={() => { setEditing(request.id); setDraft(request); setError(""); }}><Pencil size={16}/> Edit details</button><button className="button primary" disabled={!!saving || !request.licence_number || !request.requested_vehicle_type} onClick={() => approve(request)}>{saving === request.id ? <Loader2 className="spin" size={16}/> : <ArrowRight size={16}/>} Approve driver</button></div>}
      {(!request.licence_number || !request.requested_vehicle_type) && <p className="registration-help">Add the missing licence number and vehicle type to approve this request.</p>}
      <p className="registration-help">Approval creates the company and vehicle if needed, then assigns this driver. Existing company and vehicle records are reused.</p>
    </div>)}</div>
  </>;
}
