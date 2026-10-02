"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDate } from "@/lib/date";

type Checkin = { id: string; created_at: string; new_value: {
  date: string; site: string; driver: string; company: string; lorry: string;
} };
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

export default function DriverCheckinRecords() {
  const [from, setFrom] = useState(siteDate());
  const [to, setTo] = useState(siteDate());
  const [rows, setRows] = useState<Checkin[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const result = await api<{ rows: Checkin[]; truncated: boolean }>(`driver-checkin?from=${from}&to=${to}`);
      setRows(result.rows);
      setTruncated(result.truncated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!quiet) setLoading(false); }
  }, [from, to]);
  useEffect(() => {
    void load();
    let inFlight = false;
    const timer = setInterval(() => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void load(true).finally(() => { inFlight = false; });
    }, 3_000);
    return () => clearInterval(timer);
  }, [load]);

  function download() {
    const lines = [["Date", "Time", "Driver", "Company", "Lorry", "Site"],
      ...rows.map(row => [row.new_value.date, row.created_at, row.new_value.driver,
        row.new_value.company, row.new_value.lorry, row.new_value.site])];
    const blob = new Blob(["\uFEFF", lines.map(line => line.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mkss-driver-checkins-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div className="panel driver-records">
    <div className="panel-head"><div><span className="eyebrow">DRIVER ACTIVITY</span><h2>Daily QR check-ins</h2></div><strong>{rows.length}</strong></div>
    <div className="driver-record-controls">
      <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label>To<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
      <button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button>
      <button className="button primary" onClick={download} disabled={!rows.length || loading || truncated}><Download size={16}/> Export CSV</button>
    </div>
    {error && <div className="notice error">{error}</div>}
    {truncated && <div className="notice error">More than 5,000 check-ins match this range. Narrow the dates before exporting.</div>}
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Time</th><th>Driver</th><th>Company</th><th>Lorry</th><th>Site</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString("en-MY")}</td><td>{row.new_value.driver}</td><td>{row.new_value.company}</td><td>{row.new_value.lorry}</td><td>{row.new_value.site}</td></tr>)}
    </tbody></table></div> : <p className="muted">No driver check-ins in this date range.</p>}
  </div>;
}
