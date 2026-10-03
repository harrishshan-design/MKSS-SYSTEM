"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Mail, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";

type DriverAccount = {
  id: string; name: string; email: string; active: boolean;
  drivers: { full_name: string; phone: string; licence_number: string | null;
    companies: { name: string } | null;
    lorries: { registration_number: string; vehicle_type: string }[] } | null;
};

export default function DriverAccounts() {
  const [rows, setRows] = useState<DriverAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<DriverAccount | null>(null);
  const [kind, setKind] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await api<DriverAccount[]>("driver-accounts")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function start(row: DriverAccount, action: "email" | "password") {
    setSelected(row); setKind(action); setEmail(row.email); setPassword(""); setConfirm("");
    setError(""); setMessage("");
  }
  function close() { setSelected(null); setPassword(""); setConfirm(""); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (kind === "password" && password !== confirm) { setError("Passwords do not match."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      await api("driver-accounts", { method: "PATCH", body: JSON.stringify(kind === "email"
        ? { kind, user_id: selected.id, email }
        : { kind, user_id: selected.id, new_password: password }) });
      setMessage(kind === "email" ? `${selected.name}'s login email was updated.` : `${selected.name}'s password was reset. Give the new password to the driver securely.`);
      close();
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  }

  return <div className="panel settings-panel driver-accounts"><div className="row between"><div><span className="eyebrow">DRIVER LOGINS</span><h2>Manage driver credentials</h2><p>Update a driver&apos;s sign-in email or set a new password. Existing passwords cannot be viewed.</p></div><button className="button secondary" onClick={refresh} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success"><Check size={16}/>{message}</div>}
    {loading ? <div className="center pad"><Loader2 className="spin" size={22}/></div> : rows.length === 0 ? <p className="muted">No approved driver accounts yet.</p> : <div className="driver-account-list">{rows.map(row => <div className="driver-account-row" key={row.id}><div><strong>{row.name}</strong><span>{row.email}</span><small>{row.drivers?.companies?.name || "No company"} · {row.drivers?.lorries?.map(lorry => lorry.registration_number).join(", ") || "No vehicle"}{!row.active && " · Inactive"}</small></div><div className="registration-controls"><button className="button secondary" onClick={() => start(row, "email")}><Mail size={15}/> Edit email</button><button className="button secondary" onClick={() => start(row, "password")}><KeyRound size={15}/> Set password</button></div></div>)}</div>}
    {selected && <form className="driver-credential-form" onSubmit={submit}>
      <h3>{kind === "email" ? `Edit ${selected.name}'s email` : `Set ${selected.name}'s password`}</h3>
      {kind === "email" ? <label>New sign-in email<input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}/></label> : <>
        <p>Use a unique password of at least 12 characters. The driver can sign in with it immediately.</p>
        <label>New password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
        <label>Confirm new password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)}/></label>
      </>}
      <div className="registration-controls"><button className="button primary" disabled={saving}>{saving && <Loader2 className="spin" size={16}/>} {kind === "email" ? "Save email" : "Reset password"}</button><button type="button" className="button secondary" onClick={close}>Cancel</button></div>
    </form>}
  </div>;
}
