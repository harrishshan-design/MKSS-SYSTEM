"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, QrCode } from "lucide-react";
import Scanner from "@/components/Scanner";
import { api } from "@/lib/client-api";
import { siteDate } from "@/lib/date";

type Checkin = { id: string; created_at: string; new_value: { site: string; lorry: string } };

export default function DriverCheckin({ onCheckedIn }: { onCheckedIn?: () => void }) {
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [day, setDay] = useState(siteDate());

  useEffect(() => {
    api<{ checkin: Checkin | null }>("driver-checkin")
      .then(result => setCheckin(result.checkin))
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    const updateDay = () => {
      const today = siteDate();
      if (today !== day) { setDay(today); setCheckin(null); }
    };
    const timer = setInterval(updateDay, 60_000);
    document.addEventListener("visibilitychange", updateDay);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", updateDay); };
  }, [day]);

  const onScan = useCallback(async (token: string) => {
    setScanning(false);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ checkin: Checkin }>("driver-checkin", {
        method: "POST", body: JSON.stringify({ token }),
      });
      setCheckin(result.checkin);
      onCheckedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }, [onCheckedIn]);

  return <section className="driver-checkin">
    <span className="eyebrow">DAILY SITE CHECK-IN</span>
    {checkin ? <div className="driver-checkin-done">
      <Check size={26}/>
      <div><strong>Checked in today</strong><span>{checkin.new_value.site} · {checkin.new_value.lorry} · {new Date(checkin.created_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</span></div>
    </div> : <>
      <h2>Scan today&apos;s site QR</h2>
      <p>Scan once at the gate. Your attendance and assigned lorry visit are saved automatically.</p>
      <button className="scan-hero driver-scan" onClick={() => setScanning(true)} disabled={busy}>
        <span className="scan-icon">{busy ? <Loader2 className="spin" size={30}/> : <QrCode size={36}/>}</span>
        <span><strong>SCAN DAILY QR</strong><small>One scan for today&apos;s check-in</small></span>
      </button>
    </>}
    {error && <div className="notice error">{error}</div>}
    {scanning && <Scanner title="Scan today's site QR" onScan={onScan} onClose={() => setScanning(false)}/>}
  </section>;
}
