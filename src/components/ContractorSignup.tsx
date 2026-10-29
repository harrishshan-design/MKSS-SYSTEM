"use client";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { WORK_TYPES } from "@/lib/contractors";

export default function ContractorSignup({ onBack, onSignIn }: { onBack: () => void; onSignIn: (ic: string) => void }) {
  const [form, setForm] = useState({ full_name: "", identity_reference: "", company_name: "", work_type: "" });
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/contractors/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Registration failed");
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <><button className="auth-back" onClick={onBack}><ArrowLeft size={16}/> Back to sign in</button><span className="eyebrow">CONTRACTOR REGISTRATION</span>
    <h2>{done ? "Ready to sign in" : "New contractor sign up"}</h2>
    {done ? <><p>Sign in with your IC number as both your username and initial password. Then scan the same site QR used by drivers to clock in and out. No admin approval is needed. If you already registered, use your existing account.</p><button className="button primary full" onClick={() => onSignIn(form.identity_reference)}>Contractor sign in</button></>
    : <><p>Register your details once, sign in and scan the site QR. No admin approval or email is needed. Your IC number will be your sign-in ID and initial password.</p><form className="signup-form" onSubmit={submit}><div className="signup-group">
      <label>Name<input required autoComplete="name" minLength={2} maxLength={120} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}/></label>
      <label>IC number<input required minLength={12} maxLength={14} inputMode="numeric" placeholder="e.g. 900101-10-1234" value={form.identity_reference} onChange={e => setForm({ ...form, identity_reference: e.target.value })}/></label>
      <label>Company name<input required minLength={2} maxLength={120} value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })}/></label>
      <label>Work type<select required value={form.work_type} onChange={e => setForm({ ...form, work_type: e.target.value })}><option value="">Select work type</option>{WORK_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
    </div>{error && <div className="notice error">{error}</div>}<button className="button primary full" disabled={busy}>{busy && <Loader2 size={16} className="spin"/>}Register contractor</button></form></>}
  </>;
}
