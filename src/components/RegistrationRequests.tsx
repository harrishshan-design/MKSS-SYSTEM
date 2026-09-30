"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";

type Request = { id: string; email: string; full_name: string; phone: string; licence_number: string | null; requested_company: string; requested_lorry: string; created_at: string };
type Company = { id: string; name: string; active: boolean };
type Lorry = { id: string; registration_number: string; company_id: string; assigned_driver_id: string | null; active: boolean };

export default function RegistrationRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [lorries, setLorries] = useState<Lorry[]>([]);
  const [selection, setSelection] = useState<Record<string, { company_id: string; lorry_id: string }>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [newRequests, newCompanies, newLorries] = await Promise.all([
        api<Request[]>("signup/requests"), api<Company[]>("records/companies"), api<Lorry[]>("records/lorries"),
      ]);
      setRequests(newRequests); setCompanies(newCompanies); setLorries(newLorries);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function approve(request: Request) {
    const choice = selection[request.id];
    if (!choice?.company_id || !choice.lorry_id) { setError("Select a company and an unassigned lorry first."); return; }
    setSaving(request.id); setError(""); setMessage("");
    try {
      await api("signup/approve", { method: "POST", body: JSON.stringify({ request_id: request.id, ...choice }) });
      setMessage(`${request.full_name} can now sign in as a driver.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(""); }
  }

  return <><div className="page-header"><div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Driver registrations</h1><p>Review requests and assign an existing company and unassigned lorry.</p></div><button className="button secondary" onClick={refresh} disabled={busy}><RefreshCw size={16}/> Refresh</button></div>
    {error && <div className="notice error">{error}</div>}{message && <div className="notice success"><Check size={17}/>{message}</div>}
    {busy && <div className="panel pad center"><Loader2 className="spin" size={22}/></div>}
    {!busy && requests.length === 0 && <div className="panel pad center"><h2>No pending registrations</h2><p className="muted">New driver requests will appear here.</p></div>}
    <div className="registration-list">{requests.map(request => {
      const choice = selection[request.id] || { company_id: "", lorry_id: "" };
      const eligible = lorries.filter(lorry => lorry.active && !lorry.assigned_driver_id && lorry.company_id === choice.company_id);
      return <div className="panel registration-card" key={request.id}><div className="registration-summary"><div><span className="eyebrow">PENDING DRIVER</span><h2>{request.full_name}</h2><p>{request.email} · {request.phone}</p><p>Requested: <strong>{request.requested_company}</strong> · <strong>{request.requested_lorry}</strong>{request.licence_number && <> · Licence {request.licence_number}</>}</p></div><span className="muted">{new Date(request.created_at).toLocaleDateString("en-MY")}</span></div><div className="registration-controls"><label>Company<select value={choice.company_id} onChange={event => setSelection(previous => ({ ...previous, [request.id]: { company_id: event.target.value, lorry_id: "" } }))}><option value="">Select company</option>{companies.filter(company => company.active).map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Unassigned lorry<select value={choice.lorry_id} onChange={event => setSelection(previous => ({ ...previous, [request.id]: { ...choice, lorry_id: event.target.value } }))}><option value="">Select lorry</option>{eligible.map(lorry => <option key={lorry.id} value={lorry.id}>{lorry.registration_number}</option>)}</select></label><button className="button primary" disabled={saving === request.id || !choice.company_id || !choice.lorry_id} onClick={() => approve(request)}>{saving === request.id ? <Loader2 className="spin" size={16}/> : <ArrowRight size={16}/>} Approve</button></div><p className="registration-help">The selected company and lorry must be registered in MKSS SYSTEM first. Approval creates the driver record and activates access.</p></div>;
    })}</div>
  </>;
}
