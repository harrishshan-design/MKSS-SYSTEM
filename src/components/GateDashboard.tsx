"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, CalendarCheck, Check, Loader2, LogOut, QrCode, RefreshCw, ShieldCheck, Truck, X } from "lucide-react";
import Scanner from "@/components/Scanner";
import { api } from "@/lib/client-api";
import { publicClient } from "@/lib/supabase";
import { siteClockTime, siteDate } from "@/lib/date";
import type { Actor } from "@/lib/types";

export type GateVisit = {
  id: string; visit_code: string; status: string; visit_date: string;
  security_registered_at: string; company_time_in: string | null; company_time_out: string | null;
  loading_area_in: string | null; loading_area_out: string | null; last_location_at: string | null;
  drivers?: { full_name: string } | null;
  lorries?: { registration_number: string; vehicle_type: string } | null;
  companies?: { name: string } | null;
};
type Lookup = {
  driver: { id: string; full_name: string; active: boolean; companies?: { name: string } | null };
  lorry: { registration_number: string; vehicle_type: string };
  activeVisit: { id: string; visit_code: string; status: string } | null;
};

export default function GateDashboard({ actorInfo, visits, refresh, tick }: {
  actorInfo: Actor; visits: GateVisit[]; refresh: () => Promise<void>; tick: number;
}) {
  const [scanner, setScanner] = useState<"entry" | "exit" | "attendance" | null>(null);
  const [pendingAction, setPendingAction] = useState<"entry" | "exit" | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [scannedCode, setScannedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const open = visits.filter(visit => !["COMPLETED", "CANCELLED"].includes(visit.status));
  const inside = open.filter(visit => Boolean(visit.company_time_in) && visit.status !== "LEAVING");
  const leaving = open.filter(visit => visit.status === "LEAVING");
  const completed = visits.filter(visit => visit.visit_date === siteDate() && visit.status === "COMPLETED");
  const exceptions = open.filter(visit => !visit.last_location_at || tick - new Date(visit.last_location_at).getTime() > 120_000);
  const filtered = open.filter(visit =>
    `${visit.lorries?.registration_number} ${visit.drivers?.full_name} ${visit.companies?.name}`.toLowerCase().includes(search.toLowerCase()));

  const onScan = useCallback(async (code: string) => {
    setScanner(null); setBusy(true); setError(""); setMessage("");
    try {
      if (scanner === "attendance") {
        const result = await api<{ time_out: string | null }>("attendance", {
          method: "PUT", body: JSON.stringify({ token: code, deviceId: navigator.userAgent.slice(0, 90) }),
        });
        setMessage(result.time_out ? "You are clocked out for today." : "You are clocked in.");
        await refresh();
      } else {
        setPendingAction(scanner === "exit" ? "exit" : "entry");
        setScannedCode(code);
        setLookup(await api<Lookup>("scan", { method: "POST", body: JSON.stringify({ token: code }) }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [scanner, refresh]);

  async function confirm(action: "entry" | "exit") {
    setBusy(true); setError("");
    try {
      const result = await api<{ visit: { visit_code: string }; duplicate?: boolean }>(action, {
        method: "POST", body: JSON.stringify({ token: scannedCode }),
      });
      setMessage(action === "entry"
        ? result.duplicate ? `This vehicle already has active visit ${result.visit.visit_code}.` : `Gate entry saved: ${result.visit.visit_code}.`
        : `Gate exit saved at the current time: ${result.visit.visit_code}.`);
      setLookup(null); setScannedCode(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function confirmStage(visit: GateVisit, stage: "start" | "finish") {
    setBusy(true); setError(""); setMessage("");
    try {
      await api("stage", { method: "POST", body: JSON.stringify({ visit_id: visit.id, stage }) });
      setMessage(`${visit.lorries?.registration_number || visit.visit_code}: loading ${stage === "start" ? "started" : "finished"} at the current time.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const currentStage = (visit: GateVisit) => visit.status === "LEAVING" ? "Leaving site"
    : visit.loading_area_in && !visit.loading_area_out ? "Loading / unloading"
    : visit.loading_area_out ? "Loading complete"
    : visit.company_time_in ? "Inside site" : "Awaiting entry";

  return <div className="guard-shell"><header className="mobile-top"><div className="brand light"><div className="brand-symbol"><Truck size={23}/></div><div><strong>MKSS</strong><span>GATE LIVE</span></div></div><button className="icon-button light-button" onClick={() => publicClient().auth.signOut()} aria-label="Sign out"><LogOut size={21}/></button></header>
    <main className="guard-content"><div className="guard-welcome"><span className="eyebrow">LIVE GATE DASHBOARD</span><h1>Gate status, {actorInfo.name.split(" ")[0]}.</h1><p>Inside, leaving, and exited vehicles update every few seconds.</p></div>
      {error && <div className="notice error"><AlertTriangle size={17}/>{error}</div>}
      {message && <div className="notice success"><Check size={17}/>{message}</div>}
      <button className="scan-hero" onClick={() => setScanner("entry")} disabled={busy}><span className="scan-icon"><QrCode size={36}/></span><span><strong>SCAN ENTRY</strong><small>Confirm a vehicle arriving at the gate</small></span></button>
      <div className="gate-stats"><div><strong>{inside.length}</strong><span>Inside now</span></div><div><strong>{leaving.length}</strong><span>Leaving</span></div><div><strong>{completed.length}</strong><span>Exited today</span></div><div className={exceptions.length ? "attention" : ""}><strong>{exceptions.length}</strong><span>Needs GPS review</span></div></div>
      {exceptions.length>0 && <div className="notice"><AlertTriangle size={17}/>{exceptions.length} open {exceptions.length===1?"trip has":"trips have"} no recent GPS. Scan the driver pass at the exit gate to record a real time out.</div>}
      <div className="gate-actions"><button className="button primary" onClick={() => setScanner("exit")}><QrCode size={16}/> Scan exit</button><button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16}/> Refresh</button><button className="button secondary" onClick={() => setScanner("attendance")}><CalendarCheck size={16}/> My attendance</button></div>
      <section className="guard-section"><div className="section-heading"><h2>Active vehicles</h2><span className="live-pill"><span/> {open.length} OPEN</span></div><input className="gate-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search vehicle, driver or company"/>
        {filtered.length ? filtered.map(visit => <div className="gate-row" key={visit.id}><div><strong>{visit.lorries?.registration_number || "Vehicle"}</strong><span>{visit.drivers?.full_name || "Driver"} · {visit.companies?.name || "Company"}</span><small>{visit.visit_code} · Arrival {siteClockTime(visit.security_registered_at)} · In {siteClockTime(visit.company_time_in)}</small>{visit.company_time_in && visit.status !== "LEAVING" && !visit.loading_area_out && <div className="gate-row-actions"><button className="mini-button" disabled={busy} onClick={() => void confirmStage(visit,visit.loading_area_in ? "finish" : "start")}>{visit.loading_area_in ? "Finish loading" : "Start loading"}</button></div>}</div><div className="gate-row-status"><b>{currentStage(visit)}</b><small>{visit.last_location_at && tick-new Date(visit.last_location_at).getTime()<=120_000 ? `GPS ${siteClockTime(visit.last_location_at)}` : "GPS not current"}</small></div></div>)
          : <div className="empty"><Truck size={26}/><h3>No open vehicles</h3><p>Scanned entries appear here immediately.</p></div>}
      </section>
      <section className="guard-section"><div className="section-heading"><h2>Exited today</h2><span>{completed.length} completed</span></div>{completed.length ? completed.slice(0, 20).map(visit => <div className="gate-row" key={visit.id}><div><strong>{visit.lorries?.registration_number || "Vehicle"}</strong><span>{visit.drivers?.full_name || "Driver"} · {visit.visit_code}</span></div><div className="gate-row-status"><b>Outside</b><small>Out {siteClockTime(visit.company_time_out)}</small></div></div>) : <p className="muted">No exits recorded today.</p>}</section>
      <div className="inline-hint"><ShieldCheck size={17}/> Match the vehicle number with the physical lorry before confirming. The gate scan records server time and is kept in the audit trail.</div>
    </main>
    {busy && <div className="busy-overlay"><Loader2 className="spin" size={28}/></div>}
    {scanner && <Scanner title={scanner==="attendance"?"Scan current site QR":scanner==="exit"?"Scan pass for gate exit":"Scan pass for gate entry"} onScan={onScan} onClose={() => setScanner(null)}/>}
    {lookup && <div className="modal-backdrop"><div className="modal guard-confirm"><div className="modal-header"><div><span className="eyebrow">DRIVER FOUND</span><h2>Confirm gate {pendingAction}</h2></div><button className="icon-button" onClick={() => setLookup(null)}><X size={20}/></button></div><div className="lookup-card"><div><span>Driver</span><strong>{lookup.driver.full_name}</strong></div><div><span>Company</span><strong>{lookup.driver.companies?.name || "—"}</strong></div><div><span>Vehicle number</span><strong>{lookup.lorry.registration_number}</strong></div><div><span>Trip</span><strong>{lookup.activeVisit?.visit_code || "New arrival"}</strong></div></div><p className="muted">Check the physical number plate before recording this movement. If the QR expires, scan the live pass again.</p>{error&&<div className="notice error">{error}</div>}{pendingAction==="entry"&&lookup.activeVisit?<div className="notice">This vehicle already has an active trip. Use Scan exit only when it is physically leaving.</div>:pendingAction==="exit"&&!lookup.activeVisit?<div className="notice error">No active trip exists for this vehicle. Check its entry first.</div>:<button className="button primary full huge" disabled={busy || !lookup.driver.active} onClick={() => { if(pendingAction) void confirm(pendingAction); }}><Check size={22}/>{pendingAction==="exit"?"CONFIRM EXIT NOW":"CONFIRM ENTRY NOW"}</button>}</div></div>}
  </div>;
}
