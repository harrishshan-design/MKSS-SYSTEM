"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut, Radio, ShieldCheck, Truck } from "lucide-react";
import { publicClient } from "@/lib/supabase";

type Registration = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  full_name: string;
  requested_company: string;
  requested_lorry: string | null;
  trip_type: "Hantar Barang" | "Ambil Barang" | null;
};

export function Login({ error }: { error: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [form, setForm] = useState({
    full_name: "", identity_reference: "", phone: "", requested_company: "", requested_lorry: "",
    has_driving_licence: "", trip_type: "", confirm_password: "",
  });

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const { error: signInError } = await publicClient().auth.signInWithPassword({ email, password });
      if (signInError) setMessage(signInError.message);
    } catch { setMessage("Connection to sign-in service lost. Check your connection and retry."); }
    finally { setBusy(false); }
  }

  async function signUp(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (password !== form.confirm_password) { setMessage("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email, password, full_name: form.full_name, identity_reference: form.identity_reference,
        phone: form.phone, requested_company: form.requested_company, requested_lorry: form.requested_lorry,
        has_driving_licence: form.has_driving_licence === "yes", trip_type: form.trip_type,
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit registration");
      setComplete(true);
      setPassword("");
      setForm(previous => ({ ...previous, confirm_password: "" }));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(previous => ({ ...previous, [key]: event.target.value }));
  return <div className="login-shell">
    <div className="login-side"><div className="brand light"><div className="brand-symbol"><Truck size={24}/></div><div><strong>MKSS</strong><span>SYSTEM</span></div></div><div className="login-side-content"><div className="eyebrow light-text">SMARTER SITE MOVEMENT</div><h1>Every vehicle.<br/>Every movement.<br/><em>In full view.</em></h1><p>One clear system for lorry arrivals, guard attendance and automatic site records.</p><div className="login-stat"><Radio size={18}/> Live operations, connected across your site</div></div><div className="login-side-foot">MKSS SYSTEM · Operations platform</div></div>
    <div className="login-panel"><div className="login-form"><div className="mobile-login-brand"><Truck size={25}/> MKSS SYSTEM</div>
      {complete ? <><span className="eyebrow">REQUEST RECEIVED</span><h2>Waiting for admin approval</h2><p>Your registration is with the administrator. No email confirmation is needed. Sign in with your password to check its status.</p><button className="button secondary full" onClick={() => { setMode("signin"); setComplete(false); }}>Back to sign in <ArrowRight size={16}/></button></>
      : mode === "signin" ? <><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Use your account or create a driver account below.</p><form onSubmit={signIn}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password"/></label>{(message || error) && <div className="notice error">{message || error}</div>}<button className="button primary full login-button" disabled={busy}>{busy && <Loader2 className="spin" size={18}/>}Sign in <ArrowRight size={18}/></button></form><button className="auth-switch" onClick={() => { setMode("signup"); setMessage(""); }}>New driver? Create an account <ArrowRight size={16}/></button><div className="login-note"><ShieldCheck size={17}/> Admin and guard access is assigned by your site administrator</div></>
      : <><button className="auth-back" onClick={() => { setMode("signin"); setMessage(""); }}><ArrowLeft size={16}/> Back to sign in</button><span className="eyebrow">DRIVER REGISTRATION</span><h2>Create a driver account</h2><p>Enter these details once. An administrator will review and approve your account.</p><form onSubmit={signUp} className="signup-form">
        <div className="signup-group"><strong>Driver details</strong>
          <label>Name<input required autoComplete="name" maxLength={120} value={form.full_name} onChange={update("full_name")}/></label>
          <label>IC number<input required minLength={6} maxLength={30} value={form.identity_reference} onChange={update("identity_reference")}/></label>
          <label>Phone number<input required type="tel" autoComplete="tel" value={form.phone} onChange={update("phone")}/></label>
          <label>Company name<input required maxLength={120} value={form.requested_company} onChange={update("requested_company")}/></label>
          <label>Vehicle number<input required minLength={2} maxLength={40} autoCapitalize="characters" value={form.requested_lorry} onChange={update("requested_lorry")} placeholder="e.g. BPK 1234"/></label>
          <label>Driving license<select required value={form.has_driving_licence} onChange={update("has_driving_licence")}><option value="">Select Yes or No</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>Type<select required value={form.trip_type} onChange={update("trip_type")}><option value="">Select type</option><option value="Hantar Barang">Hantar Barang</option><option value="Ambil Barang">Ambil Barang</option></select></label>
        </div>
        <div className="signup-group"><strong>Login details</strong>
          <label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
          <label>Password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters"/></label>
          <label>Confirm password<input required type="password" minLength={12} autoComplete="new-password" value={form.confirm_password} onChange={update("confirm_password")}/></label>
        </div>
        {message && <div className="notice error">{message}</div>}
        <button className="button primary full login-button" disabled={busy}>{busy && <Loader2 className="spin" size={18}/>}Request driver access <ArrowRight size={18}/></button>
      </form></>}
    </div></div>
  </div>;
}

export function PendingApproval({ request }: { request: Registration }) {
  return <div className="pending-shell"><div className="pending-card"><div className="brand"><div className="brand-symbol"><Truck size={24}/></div><div><strong>MKSS</strong><span>SYSTEM</span></div></div><div className="pending-icon"><Check size={28}/></div><span className="eyebrow">DRIVER REGISTRATION</span><h1>{request.status === "PENDING" ? "Awaiting approval" : "Registration reviewed"}</h1><p>{request.full_name}&apos;s request for <strong>{request.requested_company}</strong>{request.requested_lorry && <> · {request.requested_lorry}</>}{request.trip_type && <> · {request.trip_type}</>} is {request.status.toLowerCase()}. Once approved, sign in and scan the daily QR at the gate.</p><button className="button secondary" onClick={() => publicClient().auth.signOut()}><LogOut size={16}/> Sign out</button></div></div>;
}
