"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Check, Clock3, Download, Loader2, RefreshCw, Truck } from "lucide-react";
import { api } from "@/lib/client-api";
import { downloadCsv } from "@/lib/client-csv";
import { siteDateTime } from "@/lib/date";
import type { DailyReport } from "@/lib/reports";

function duration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), Math.floor(seconds % 60)]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function ReportMetric({ label, value, note, icon: Icon }: {
  label: string; value: string | number; note: string; icon: typeof Truck;
}) {
  return <div className="metric"><div className="metric-icon"><Icon size={21}/></div>
    <div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>;
}

export default function ReportsDashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setRefreshing(true);
    try { setReport(await api<DailyReport>("reports", { cache: "no-store" })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setRefreshing(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 10_000); return () => clearInterval(timer); }, [refresh]);

  async function download() {
    if (!report) return;
    setExporting(true); setExportError("");
    try { await downloadCsv(`visits?from=${report.date}&to=${report.date}`, `mkss-visits-${report.date}.csv`); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  }

  const max = Math.max(1, ...(report?.byCompany.map(company => company.count) || []));
  return <>
    <div className="page-header"><div><span className="eyebrow">OPERATIONS INTELLIGENCE</span><h1>Reports</h1>
      <p>{report ? `${report.date} · Malaysia time · Updated ${siteDateTime(report.asOf)}` : "Loading today's recorded visits…"}</p></div>
      <div className="header-actions"><button className="button secondary" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""}/> Refresh</button>
        <button className="button secondary" onClick={() => void download()} disabled={!report || exporting}><Download size={17}/>{exporting ? "Exporting…" : "Export all CSV"}</button></div></div>
    {error && <div className="notice error">{error}{report && " Showing the last successful report; check its update time above."}</div>}
    {exportError && <div className="notice error">{exportError}</div>}
    {!report ? <div className="panel pad center">{refreshing && <Loader2 className="spin" size={22}/>}<p>{error ? "Report unavailable. Please refresh." : "Reading visit records…"}</p></div> : <>
      <div className="metrics-grid report-metrics">
        <ReportMetric label="Visits today" value={report.totalVisits} note="Recorded trips, including repeat trips" icon={Truck}/>
        <ReportMetric label="Closed trips" value={report.completedVisits} note={report.unverifiedTimeouts ? `${report.unverifiedTimeouts} timer checkouts await exit verification` : "Includes completed and timer-ended records"} icon={Check}/>
        <ReportMetric label="Avg. loading time" value={report.averageLoadingSeconds === null ? "—" : report.averageLoadingSeconds > 0 && report.averageLoadingSeconds < 60 ? "<1 min" : `${Math.round(report.averageLoadingSeconds / 60)} min`} note={report.loadingSampleCount ? `Based on ${report.loadingSampleCount} recorded loading durations` : "No recorded loading durations"} icon={Activity}/>
        <ReportMetric label="Longest closed trip" value={report.longestVisitSeconds === null ? "—" : duration(report.longestVisitSeconds)} note="Recorded duration, including timer checkouts" icon={Clock3}/>
      </div>
      {report.cancelledVisits > 0 && <div className="notice">Visit totals include {report.cancelledVisits} cancelled {report.cancelledVisits === 1 ? "record" : "records"}.</div>}
      <div className="two-col"><div className="panel"><div className="panel-head"><div><span className="eyebrow">TRANSPORT ACTIVITY</span><h2>Visits by company</h2></div><span className="muted">{report.byCompany.length} companies</span></div>
        {report.byCompany.length ? <>{report.byCompany.map(company => <div className="bar-row" key={company.id} style={{ gridTemplateColumns: "minmax(0,1fr) minmax(60px,1fr) 40px" }}>
          <span style={{ overflowWrap: "anywhere" }}>{company.name}</span><div className="bar-track" aria-hidden="true"><div style={{ width: `${company.count / max * 100}%` }}/></div><strong>{company.count}</strong></div>)}
          <div className="report-line"><span>All companies · total visits</span><strong>{report.totalVisits}</strong></div></> : <div className="empty"><h3>No visits recorded today</h3><p>Company totals appear when drivers check in.</p></div>}
      </div><div className="panel"><div className="panel-head"><div><span className="eyebrow">CHECK-IN ACTIVITY</span><h2>Registrations by source</h2></div></div>
        {report.byRegistrar.length ? report.byRegistrar.map(registrar => <div className="report-line" key={registrar.id}><span>{registrar.name}</span><strong>{registrar.count} visits</strong></div>) : <div className="empty"><p>No registrations today.</p></div>}
      </div></div>
    </>}
  </>;
}
