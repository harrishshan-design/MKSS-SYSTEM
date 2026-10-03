"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut, Radio, ShieldCheck, Truck } from "lucide-react";
import { publicClient } from "@/lib/supabase";

type Registration = { status: "PENDING" | "APPROVED" | "REJECTED"; full_name: string; requested_company: string; requested_lorry: string };

export function Login({ error }: { error: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", licence_number: "", identity_reference: "", requested_company: "", company_contact_person: "", company_phone: "", company_email: "", requested_lorry: "", requested_vehicle_type: "", confirm_password: "" });

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const { error: signInError } = await publicClient().auth.signInWithPassword({ email, password });
      if (signInError) setMessage(signInError.message);
    } catch {
      setMessage("Connection to sign-in service lost. Check your connection and retry.");
    } finally { setBusy(false); }
  }

  async function signUp(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (password !== form.confirm_password) { setMessage("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, ...form }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit registration");
      setComplete(true);
      setPassword("");
      setForm(previous => ({ ...previous, confirm_password: "" }));
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm(previous => ({ ...previous, [key]: event.target.value }));
  return <div className="login-shell">
    <div className="login-side"><div className="brand light"><div className="brand-symbol"><Truck size={24}/></div><div><strong>MKSS</strong><span>SYSTEM</span></div></div><div className="login-side-content"><div className="eyebrow light-text">SMARTER SITE MOVEMENT</div><h1>Every vehicle.<br/>Every movement.<br/><em>In full view.</em></h1><p>One clear system for lorry arrivals, guard attendance and automatic site records.</p><div className="login-stat"><Radio size={18}/> Live operations, connected across your site</div></div><div className="login-side-foot">MKSS SYSTEM · Operations platform</div></div>
    <div className="login-panel"><div className="login-form"><div className="mobile-login-brand"><Truck size={25}/> MKSS SYSTEM</div>
      {complete ? <><span className="eyebrow">REQUEST RECEIVED</span><h2>Waiting for admin approval</h2><p>Your registration is with the administrator. No email confirmation is needed. You can sign in with your password to check your approval status.</p><button className="button secondary full" onClick={() => { setMode("signin"); setComplete(false); }}>Back to sign in <ArrowRight size={16}/></button></> : mode === "signin" ? <><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Use your account or create a driver account below.</p><form onSubmit={signIn}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password"/></label>{(message || error) && <div className="notice error">{message || error}</div>}<button className="button primary full login-button" disabled={busy}>{busy && <Loader2 className="spin" size={18}/>}Sign in <ArrowRight size={18}/></button></form><button className="auth-switch" onClick={() => { setMode("signup"); setMessage(""); }}>New driver? Create an account <ArrowRight size={16}/></button><div className="login-note"><ShieldCheck size={17}/> Admin and guard access is assigned by your site administrator</div></> : <><button className="auth-back" onClick={() => { setMode("signin"); setMessage(""); }}><ArrowLeft size={16}/> Back to sign in</button><span className="eyebrow">DRIVER REGISTRATION</span><h2>Create a driver account</h2><p>Enter your details once. After admin approval, scan the daily QR to check in.</p><form onSubmit={signUp} className="signup-form"><div className="signup-group"><strong>Driver details</strong><label>Driver full name<input required autoComplete="name" maxLength={120} value={form.full_name} onChange={update("full_name")}/></label><label>Email address<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label><label>Phone number<input type="tel" required autoComplete="tel" value={form.phone} onChange={update("phone")}/></label><label>Driving licence number<input required maxLength={80} value={form.licence_number} onChange={update("licence_number")}/></label><label>IC / passport number (optional)<input maxLength={80} value={form.identity_reference} onChange={update("identity_reference")}/></label></div><div className="signup-group"><strong>Transport company</strong><label>Transport company name<input required maxLength={120} value={form.requested_company} onChange={update("requested_company")}/></label><label>Company contact person (optional)<input maxLength={120} value={form.company_contact_person} onChange={update("company_contact_person")}/></label><label>Company phone (optional)<input type="tel" maxLength={30} value={form.company_phone} onChange={update("company_phone")}/></label><label>Company email (optional)<input type="email" maxLength={254} value={form.company_email} onChange={update("company_email")}/></label></div><div className="signup-group"><strong>Vehicle</strong><label>Vehicle registration number<input required maxLength={40} value={form.requested_lorry} onChange={update("requested_lorry")}/></label><label>Vehicle type<input required maxLength={80} value={form.requested_vehicle_type} onChange={update("requested_vehicle_type")} placeholder="e.g. Box lorry, trailer"/></label></div><div className="signup-group"><strong>Account password</strong><label>Password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters"/></label><label>Confirm password<input type="password" required minLength={12} autoComplete="new-password" value={form.confirm_password} onChange={update("confirm_password")}/></label></div>{message && <div className="notice error">{message}</div>}<button className="button primary full login-button" disabled={busy}>{busy && <Loader2 className="spin" size={18}/>}Request driver access <ArrowRight size={18}/></button></form></>}
    </div></div>
  </div>;
}

export function PendingApproval({ request }: { request: Registration }) {
  return <div className="pending-shell"><div className="pending-card"><div className="brand"><div className="brand-symbol"><Truck size={24}/></div><div><strong>MKSS</strong><span>SYSTEM</span></div></div><div className="pending-icon"><Check size={28}/></div><span className="eyebrow">DRIVER REGISTRATION</span><h1>{request.status === "PENDING" ? "Awaiting approval" : "Registration reviewed"}</h1><p>Your request for <strong>{request.requested_company}</strong> and lorry <strong>{request.requested_lorry}</strong> is {request.status.toLowerCase()}. An administrator must approve and assign your lorry before you can use MKSS SYSTEM.</p><button className="button secondary" onClick={() => publicClient().auth.signOut()}><LogOut size={16}/> Sign out</button></div></div>;
}
