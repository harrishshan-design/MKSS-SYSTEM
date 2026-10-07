"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "@/lib/client-api";
import QRCodeView from "@/components/QRCode";

type Pass = { id: string; full_name: string; qr_active: boolean; pass_code: string | null };

export default function AdminDriverPass({ driverId, name, onClose }: { driverId: string; name: string; onClose: () => void }) {
  const [pass, setPass] = useState<Pass | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setPass(await api<Pass>(`qr?driver_id=${driverId}`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [driverId]);
  useEffect(() => { void load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, [load]);
  async function update(active: boolean) {
    setBusy(true); setError("");
    try { await api("qr", { method: "POST", body: JSON.stringify({ driver_id: driverId, active }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal qr-modal"><div className="modal-header"><div><span className="eyebrow">ROTATING DRIVER PASS</span><h2>{name}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>{error&&<div className="notice error">{error}</div>}{pass ? pass.pass_code?<QRCodeView value={pass.pass_code} label={name} secure/>:<p className="muted center">This pass is inactive.</p> : <div className="center pad"><Loader2 className="spin"/></div>}<div className="modal-actions"><button className="button secondary" disabled={busy||!pass?.qr_active} onClick={()=>void update(false)}>Deactivate pass</button><button className="button secondary" disabled={busy} onClick={()=>{if(confirm("Reset driver pass? Old screenshots and codes will stop working."))void update(true)}}>Reset pass</button></div></div></div>;
}
