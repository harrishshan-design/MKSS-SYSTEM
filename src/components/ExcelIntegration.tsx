"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client-api";

type SyncItem = { id: string; entity_type: string; sync_status: string; sync_attempts: number; last_sync_error: string | null; last_sync_time: string | null };
type Status = {
  setup: { ready: boolean; missing: string[]; issues: string[] };
  connection: { connected_at: string } | null;
  connected: boolean;
  workbook: { name: string; webUrl: string | null; worksheetCount: number } | null;
  connectionError: string | null;
  queue: SyncItem[];
};

function date(value: string | null) { return value ? new Date(value).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"; }

export default function ExcelIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await api<Status>("microsoft/status")); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const result = new URLSearchParams(location.search).get("excel");
    if (result) setMessage(result === "connected" ? "Microsoft account and workbook verified." : "Microsoft connection did not complete. Check the app registration, workbook access and redirect URL.");
  }, [load]);

  async function connect() {
    setBusy(true); setError("");
    try { const result = await api<{ url: string }>("microsoft/connect"); location.href = result.url; }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await api<{ synced: number; failed: number }>("microsoft/retry", { method: "POST" }); setMessage(`Sync run finished: ${result.synced} synced, ${result.failed} failed.`); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  return <><div className="page-header"><div><span className="eyebrow">MICROSOFT GRAPH</span><h1>Excel Online sync</h1><p>Database records are mirrored into a OneDrive for Business or SharePoint workbook.</p></div><div className="header-actions"><button className="button secondary" onClick={load} disabled={loading || busy}><RefreshCw size={16}/> Refresh status</button><button className="button primary" disabled={busy || loading || !status?.setup.ready} onClick={connect}>{busy ? <Loader2 size={17} className="spin"/> : <ArrowUpRight size={17}/>} {status?.connection ? "Reconnect Microsoft" : "Connect Microsoft"}</button></div></div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className={`notice ${message.startsWith("Microsoft connection did not") ? "error" : "success"}`}><Check size={17}/>{message}</div>}
    {loading && <div className="notice"><Loader2 className="spin" size={17}/> Checking Microsoft connection…</div>}
    {status && !status.setup.ready && <div className="panel microsoft-setup"><span className="eyebrow">SETUP REQUIRED</span><h2>Complete Microsoft configuration</h2><p>Set the following server environment variables, then restart or redeploy the app. Register <code>APP_URL/api/microsoft/callback</code> as the Entra web redirect URI.</p><div className="microsoft-missing">{status.setup.missing.map(name => <code key={name}>{name}</code>)}{status.setup.issues.map(issue => <span key={issue}>{issue}</span>)}</div></div>}
    {status && <><div className="integration-status"><div className="integration-logo">X</div><div><strong>{status.workbook?.name || "Microsoft Excel Online"}</strong><span>{status.connected ? `Connected · ${date(status.connection?.connected_at || null)} · ${status.workbook?.worksheetCount} worksheets` : status.connection ? "Saved connection needs attention" : "Not connected"}</span>{status.connected && status.workbook?.webUrl && <a href={status.workbook.webUrl} target="_blank" rel="noopener noreferrer">Open workbook <ArrowUpRight size={14}/></a>}</div><span className={`badge ${status.connected ? "connected" : "failed"}`}>{status.connected ? "CONNECTED" : "DISCONNECTED"}</span></div>
      {status.connectionError && <div className="notice error">Workbook access check failed: {status.connectionError}</div>}
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">RELIABLE DELIVERY</span><h2>Synchronization queue</h2></div><button className="button secondary" disabled={busy || !status.connected} onClick={syncNow}><RefreshCw size={17}/> Sync now</button></div>{status.queue.length ? <div className="table-scroll"><table><thead><tr><th>Record</th><th>Status</th><th>Attempts</th><th>Last sync</th><th>Error</th></tr></thead><tbody>{status.queue.map(item => <tr key={item.id}><td><strong>{item.entity_type.replaceAll("_", " ")}</strong><small>{item.id.slice(0, 8)}</small></td><td><span className={`badge ${item.sync_status}`}>{item.sync_status.toUpperCase()}</span></td><td>{item.sync_attempts}</td><td>{date(item.last_sync_time)}</td><td className="error-cell">{item.last_sync_error || "—"}</td></tr>)}</tbody></table></div> : <div className="empty"><h3>Sync queue is empty</h3><p>New records and movement events will appear here.</p></div>}</div><div className="inline-hint"><ShieldCheck size={17}/> The database stays authoritative. Microsoft credentials and refresh tokens remain on the server.</div></>}
  </>;
}
