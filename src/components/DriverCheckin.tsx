"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, QrCode } from "lucide-react";
import Scanner from "@/components/Scanner";
import { api } from "@/lib/client-api";
import { siteClockTime, siteDate } from "@/lib/date";

type Checkin = { id: string; created_at: string; new_value: { site: string; lorry: string } };
type Trip = { id: string; visit_code: string; company_time_in: string | null;
  company_time_out: string | null; checkout_method: string | null };

export default function DriverCheckin({ onCheckedIn, tripCount, checkoutCount, trips, activeVisit, unverifiedTimeout }: {
  onCheckedIn?: () => void | Promise<void>; tripCount: number; checkoutCount: number; trips: Trip[];
  activeVisit: boolean; unverifiedTimeout: boolean;
}) {
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
      await onCheckedIn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }, [onCheckedIn]);

  return <section className="driver-checkin">
    <span className="eyebrow">DAILY ATTENDANCE &amp; TRIPS</span>
    {checkin ? <div className="driver-checkin-done">
      <Check size={26}/>
      <div><strong>Attendance recorded today</strong><span>{checkin.new_value.site} · {checkin.new_value.lorry} · {siteClockTime(checkin.created_at)}</span><small>Location was not required. Scan again after each confirmed checkout.</small></div>
    </div> : <><h2>Scan today&apos;s site QR</h2><p>Your first scan saves attendance and opens a trip immediately, even if phone location is off.</p></>}
    <div className="driver-trip-summary"><div><strong>{tripCount}</strong><span>Trips checked in today</span></div><div><strong>{checkoutCount}</strong><span>Trips checked out today</span></div></div>
    {activeVisit && checkin ? <div className="notice">A trip is open. Check out before scanning for another trip.</div>
      : unverifiedTimeout ? <div className="notice">The last trip timed out. Ask security to confirm the physical exit before scanning again.</div>
      : <button className="scan-hero driver-scan" onClick={() => setScanning(true)} disabled={busy}>
        <span className="scan-icon">{busy ? <Loader2 className="spin" size={30}/> : <QrCode size={36}/>}</span>
        <span><strong>{checkin ? `SCAN FOR TRIP ${tripCount + 1}` : "SCAN SITE QR"}</strong><small>{checkin ? "Daily or backup QR · new trip record" : activeVisit ? "Record attendance for your open trip" : `Attendance and trip ${tripCount + 1}`}</small></span>
      </button>}
    {trips.length > 0 && <div className="driver-trip-list"><strong>Today&apos;s trips</strong>{trips.slice(0, 4).map((trip, index) =>
      <div key={trip.id}><span>Trip {tripCount - index} · {trip.visit_code}</span><small>In {siteClockTime(trip.company_time_in)} · {trip.company_time_out ? `${trip.checkout_method === "TIME_LIMIT" ? "Timed out, exit unverified" : "Out"} ${siteClockTime(trip.company_time_out)}` : "Still in"}</small></div>)}</div>}
    {error && <div className="notice error">{error}</div>}
    {scanning && <Scanner title="Scan today's site QR" onScan={onScan} onClose={() => setScanning(false)}/>}
  </section>;
}
