"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { TRIP_TYPES } from "@/lib/trip-type";
import PasswordInput from "@/components/PasswordInput";

const empty = { full_name: "", email: "", identity_reference: "", phone: "", requested_company: "", requested_lorry: "", has_driving_licence: "", trip_type: "" };
export default function CreateDriverAccount({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false), [form, setForm] = useState(empty), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [conflicts, setConflicts] = useState<string[]>([]);
  function change(key: keyof typeof empty, value: string) { setForm(previous => ({ ...previous, [key]: value })); setConflicts([]); setMessage(""); setError(""); }
  async function check() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ conflicts: string[] }>("driver-accounts/create", { method: "POST", body: JSON.stringify({ action: "check", email: form.email, requested_lorry: form.requested_lorry, identity_reference: form.identity_reference }) });
      setConflicts(result.conflicts); if (!result.conflicts.length) setMessage("No matching email, lorry or IC found. Creation will check again before saving.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await api("driver-accounts/create", { method: "POST", body: JSON.stringify({ ...form, action: "create", has_driving_licence: form.has_driving_licence === "yes" }) });
      setMessage(`Driver account created for ${form.email}. The driver can sign in now using their IC as password.`);
      setForm(empty); setConflicts([]); setOpen(false); onCreated?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="create-driver-account">
    <button className="button primary" onClick={() => { setOpen(value => !value); setError(""); }} disabled={busy}>{open ? "Close account form" : "+ Create Driver Account"}</button>
    {message && <p className="notice success" role="status">{message}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {open && <form className="form-grid" onSubmit={create}>
      <h3 className="full">Create an approved driver login</h3><p className="full muted">Admin-created accounts are approved immediately. Existing accounts are under User accounts; Driver registrations shows pending approvals. Email, lorry and IC duplicates are blocked.</p>
      <label>Driver name<input required minLength={2} maxLength={120} value={form.full_name} onChange={e => change("full_name", e.target.value)}/></label>
      <label>Email address<input required type="email" maxLength={254} value={form.email} onChange={e => change("email", e.target.value)}/></label>
      <label>IC number / login password<PasswordInput required minLength={12} maxLength={30} autoComplete="new-password" value={form.identity_reference} onChange={e => change("identity_reference", e.target.value)}/></label>
      <label>Phone number<input required type="tel" minLength={6} maxLength={30} value={form.phone} onChange={e => change("phone", e.target.value)}/></label>
      <label>Company name<input required minLength={2} maxLength={120} value={form.requested_company} onChange={e => change("requested_company", e.target.value)}/></label>
      <label>Lorry / vehicle number<input required minLength={2} maxLength={40} value={form.requested_lorry} onChange={e => change("requested_lorry", e.target.value.toUpperCase())}/></label>
      <label>Driving licence<select required value={form.has_driving_licence} onChange={e => change("has_driving_licence", e.target.value)}><option value="">Select Yes / No</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Trip type<select required value={form.trip_type} onChange={e => change("trip_type", e.target.value)}><option value="">Select type</option>{TRIP_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      {conflicts.length > 0 && <div className="notice error full" role="alert"><strong>Existing records found</strong><ul>{conflicts.map(flag => <li key={flag}>{flag}</li>)}</ul><p>Check Drivers, Lorries, User accounts or pending Driver registrations before continuing.</p></div>}
      <div className="registration-controls full"><button type="button" className="button secondary" disabled={busy || !form.email || !form.requested_lorry || !form.identity_reference} onClick={() => void check()}>Check duplicates</button><button className="button primary" disabled={busy || conflicts.length > 0}>{busy ? "Checking / saving…" : "Create and approve driver"}</button></div>
    </form>}
  </section>;
}
