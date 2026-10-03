"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";

type Request = {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  licence_number: string | null;
  requested_company: string;
  requested_lorry: string;
  created_at: string;
};

export default function RegistrationRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setRequests(await api<Request[]>("signup/requests"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function approve(request: Request) {
    setSaving(request.id);
    setError("");
    setMessage("");
    try {
      await api("signup/approve", {
        method: "POST",
        body: JSON.stringify({ request_id: request.id }),
      });
      setMessage(`${request.full_name} can now sign in as a driver.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving("");
    }
  }

  return <>
    <div className="page-header">
      <div><span className="eyebrow">ACCESS MANAGEMENT</span><h1>Driver registrations</h1><p>Review each request, then approve the driver and their lorry in one step.</p></div>
      <button className="button secondary" onClick={refresh} disabled={busy}><RefreshCw size={16}/> Refresh</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success"><Check size={17}/>{message}</div>}
    {busy && <div className="panel pad center"><Loader2 className="spin" size={22}/></div>}
    {!busy && requests.length === 0 && <div className="panel pad center"><h2>No pending registrations</h2><p className="muted">New driver requests will appear here.</p></div>}
    <div className="registration-list">{requests.map(request =>
      <div className="panel registration-card" key={request.id}>
        <div className="registration-summary">
          <div><span className="eyebrow">PENDING DRIVER</span><h2>{request.full_name}</h2><p>{request.email} · {request.phone}</p><p>Requested: <strong>{request.requested_company}</strong> · <strong>{request.requested_lorry}</strong>{request.licence_number && <> · Licence {request.licence_number}</>}</p></div>
          <span className="muted">{new Date(request.created_at).toLocaleDateString("en-MY")}</span>
        </div>
        <div className="registration-controls">
          <button className="button primary" disabled={!!saving} onClick={() => approve(request)}>{saving === request.id ? <Loader2 className="spin" size={16}/> : <ArrowRight size={16}/>} Approve driver</button>
        </div>
        <p className="registration-help">Approval creates the company and lorry if needed, assigns the lorry, and lets this driver sign in. Review the submitted details before approving.</p>
      </div>
    )}</div>
  </>;
}
