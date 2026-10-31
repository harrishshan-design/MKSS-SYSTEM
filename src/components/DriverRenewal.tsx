"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { TRIP_TYPES } from "@/lib/trip-type";
type Details = { full_name: string; phone: string; requested_company: string; requested_lorry: string; has_driving_licence: boolean; trip_type: string };
export default function DriverRenewal() {
  const [form, setForm] = useState<Details | null>(null), [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ person: { full_name: string; phone: string; companies: { name: string }; has_driving_licence: boolean; default_trip_type: string }; vehicle: string; pending: boolean }>("driver-renewal").then(data => {
    setPending(data.pending); setForm({ full_name: data.person.full_name, phone: data.person.phone, requested_company: data.person.companies?.name || "", requested_lorry: data.vehicle, has_driving_licence: Boolean(data.person.has_driving_licence), trip_type: data.person.default_trip_type || "" });
  }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api("driver-renewal", { method: "POST", body: JSON.stringify(form) }); setPending(true); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  return <section className="panel settings-panel"><h2>{pending ? "Re-registration awaiting admin approval" : "Registration expired"}</h2><p>{pending ? "Your existing driver account will be reactivated when the admin approves. Your driver ID and QR identity will stay the same." : "Your registration expired after six months without activity. Check your details and submit them for admin approval before scanning again."}</p>
    {error && <div className="notice error">{error}</div>}
    {!pending && (form ? <form onSubmit={submit}>{([['full_name','Name'],['phone','Phone number'],['requested_company','Company'],['requested_lorry','Vehicle number']] as const).map(([key,label]) => <label key={key}>{label}<input required minLength={key === "phone" ? 6 : 2} maxLength={key === "phone" ? 30 : key === "requested_lorry" ? 40 : 120} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}/></label>)}
      <label>Driving licence<select value={form.has_driving_licence ? "yes" : "no"} onChange={e => setForm({ ...form, has_driving_licence: e.target.value === "yes" })}><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Type<select required value={form.trip_type} onChange={e => setForm({ ...form, trip_type: e.target.value })}><option value="">Select type</option>{TRIP_TYPES.map(type => <option key={type}>{type}</option>)}</select></label><button className="button primary full" disabled={busy}>{busy ? "Submitting…" : "Submit re-registration"}</button>
    </form> : <p>Loading your existing details…</p>)}
  </section>;
}
