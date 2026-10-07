"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { siteDate, siteDateTime } from "@/lib/date";

type VisitRow = {
  id: string;
  visit_code: string;
  visit_date: string;
  status: string;
  company_time_in: string | null;
  company_time_out: string | null;
  last_location_at: string | null;
  drivers: { full_name: string } | null;
  lorries: { registration_number: string } | null;
  companies: { name: string } | null;
};

export default function MonitorHistory() {
  const [from, setFrom] = useState(siteDate());
  const [to, setTo] = useState(siteDate());
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api<VisitRow[]>(`history?from=${from}&to=${to}`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  return <>
    <div className="page-header"><div><span className="eyebrow">READ ONLY</span><h1>Visit history</h1><p>Review recorded driver and lorry movements.</p></div></div>
    <div className="history-filters"><label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label>To<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label></div>
    {error && <div className="notice error">{error}</div>}
    <div className="panel table-panel"><div className="panel-head"><h2>Movement records</h2><span className="muted">{rows.length} visits</span></div>
      {loading ? <p className="muted">Loading records…</p> : rows.length ? <div className="table-scroll"><table><thead><tr><th>Visit</th><th>Lorry</th><th>Driver</th><th>Company</th><th>Status</th><th>Time in</th><th>Time out</th><th>Last GPS</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.visit_code}</td><td>{row.lorries?.registration_number || "—"}</td><td>{row.drivers?.full_name || "—"}</td><td>{row.companies?.name || "—"}</td><td>{row.status.replaceAll("_", " ")}</td><td>{siteDateTime(row.company_time_in)}</td><td>{siteDateTime(row.company_time_out)}</td><td>{siteDateTime(row.last_location_at)}</td></tr>)}</tbody></table></div> : <p className="muted">No visits in this date range.</p>}
    </div>
  </>;
}
