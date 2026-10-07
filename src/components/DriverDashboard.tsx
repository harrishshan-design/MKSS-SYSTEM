"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, LogOut, MapPin, Smartphone, Truck } from "lucide-react";
import DriverCheckin from "@/components/DriverCheckin";
import QRCodeView from "@/components/QRCode";
import { api } from "@/lib/client-api";
import { siteClockTime } from "@/lib/date";
import { publicClient } from "@/lib/supabase";
import type { Actor } from "@/lib/types";

type DriverVisit = {
  id: string;
  visit_code: string;
  status: string;
  last_location_at: string | null;
  company_time_out: string | null;
};
type DriverData = {
  driver: { full_name: string; qr_token: string; default_trip_type: string | null; companies?: { name: string } | null; lorries?: { registration_number: string; active: boolean }[] };
  visits: DriverVisit[];
};
type LocationResult = { visit: DriverVisit; events: string[] };

export default function DriverDashboard({ actorInfo }: { actorInfo: Actor }) {
  const [data, setData] = useState<DriverData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const activeVisitIdRef = useRef<string | undefined>(undefined);
  const activeVisit = data?.visits?.find(visit => !["COMPLETED", "CANCELLED"].includes(visit.status));
  const activeVisitId = activeVisit?.id;
  useEffect(() => { activeVisitIdRef.current = activeVisitId; }, [activeVisitId]);

  const load = useCallback(async () => {
    try { setData(await api<DriverData>("driver")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);

  useEffect(() => { void load(); const timer = setInterval(load, 15_000); return () => clearInterval(timer); }, [load]);

  const sendPosition = useCallback(async (position: GeolocationPosition) => {
    const visitId = activeVisitIdRef.current;
    if (!visitId || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api<LocationResult>("location", { method: "POST", body: JSON.stringify({
        visit_id: visitId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString(),
        deviceId: navigator.userAgent.slice(0, 90),
      }) });
      setError("");
      if (result.events.includes("COMPANY_EXIT_CONFIRMED")) {
        setMessage(`Checked out at ${siteClockTime(result.visit.company_time_out)}. Your visit is complete.`);
      } else if (result.events.includes("COMPANY_EXIT_PENDING")) {
        setMessage("You have left the site. Time out will be recorded when fresh GPS confirms you are beyond 200 m.");
      } else {
        setMessage(`Location received at ${siteClockTime(result.visit.last_location_at)}.`);
      }
      await load();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (!detail.includes("Stale location update")) setError(detail);
    } finally { inFlight.current = false; }
  }, [load]);

  const checkNow = useCallback((silent = false) => {
    if (!navigator.geolocation) { setError("This browser does not support location sharing."); return; }
    if (!silent) { setChecking(true); setError(""); }
    navigator.geolocation.getCurrentPosition(
      position => { void sendPosition(position).finally(() => { if (!silent) setChecking(false); }); },
      cause => { setError(`Location unavailable: ${cause.message}`); if (!silent) setChecking(false); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }, [sendPosition]);

  useEffect(() => {
    if (!activeVisitId || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      position => { void sendPosition(position); },
      cause => setError(`Location unavailable: ${cause.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    const onVisible = () => { if (document.visibilityState === "visible") checkNow(true); };
    document.addEventListener("visibilitychange", onVisible);
    onVisible();
    const timer = setInterval(onVisible, 30_000);
    return () => { navigator.geolocation.clearWatch(watchId); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [activeVisitId, sendPosition, checkNow]);

  return <div className="driver-shell">
    <header className="mobile-top"><div className="brand light"><div className="brand-symbol"><Truck size={23}/></div><div><strong>MKSS</strong><span>DRIVER</span></div></div><button className="icon-button light-button" onClick={() => publicClient().auth.signOut()} aria-label="Sign out"><LogOut size={21}/></button></header>
    <main className="driver-content">
      <span className="eyebrow">YOUR DAILY CHECK-IN</span>
      <h1>Hello, {actorInfo.name.split(" ")[0]}.</h1>
      <p>Sign in once, then scan the site QR each day at the gate.</p>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success"><Check size={18}/>{message}</div>}
      {data?.driver ? <>
        {data.driver.lorries?.some(lorry => lorry.active)
          ? <DriverCheckin onCheckedIn={load}/>
          : <div className="notice">Your account is approved. Ask the admin to assign your lorry before scanning the daily QR.</div>}
        <div className="driver-pass"><div className="pass-header"><span>YOUR PERMANENT DRIVER PASS</span><Truck size={25}/></div><QRCodeView value={data.driver.qr_token} label={data.driver.full_name}/><div className="pass-bottom"><div><span>TRANSPORT COMPANY</span><strong>{data.driver.companies?.name || "—"}</strong></div><div><span>ASSIGNED LORRY</span><strong>{data.driver.lorries?.find(lorry => lorry.active)?.registration_number || "—"}</strong></div><div><span>TYPE</span><strong>{data.driver.default_trip_type || "—"}</strong></div></div></div>
        {activeVisit && <div className="location-card">
          <div className="section-heading"><h2>Active visit</h2><span className={`badge ${activeVisit.status.toLowerCase().replaceAll("_", "-")}`}>{activeVisit.status.replaceAll("_", " ")}</span></div>
          <strong>{activeVisit.visit_code}</strong>
          <p>Time out is saved when a fresh GPS reading confirms you are beyond 200 m from the site.</p>
          <button className="button primary full" onClick={() => checkNow()} disabled={checking}><MapPin size={18}/>{checking ? "Checking location…" : "Check location / time out"}</button>
          <small>Last accepted GPS: {siteClockTime(activeVisit.last_location_at)} · Automatic GPS runs while this page is open</small>
        </div>}
        <div className="inline-hint"><Smartphone size={17}/> Keep this page open with location permission enabled until you leave. If the page closes or moves to the background, reopen it and tap “Check location / time out”. Time out is saved only when fresh GPS confirms you are beyond 200 m.</div>
      </> : <div className="center pad"><Loader2 className="spin"/></div>}
    </main>
  </div>;
}
