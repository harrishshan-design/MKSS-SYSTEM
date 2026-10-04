"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";

type Destination = { id: string; name: string; kind: "worksheet" | "table"; worksheetName?: string };
type SyncItem = { id: string; entity_type: string; sync_status: string; sync_attempts: number; last_sync_error: string | null; last_sync_time: string | null };
type ConnectionStatus = "connected" | "authentication_required" | "workbook_inaccessible" | "permission_denied" | "invalid_spreadsheet_link";
type Status = {
  setup: { ready: boolean; missing: string[]; issues: string[] };
  status: ConnectionStatus;
  connection: { connected_at: string; workbook_name: string | null; workbook_web_url: string | null; selected_target_kind: "worksheet" | "table" | null; selected_target_id: string | null; selected_target_name: string | null } | null;
  destinations: Destination[];
  connectionError: string | null;
  queue: SyncItem[];
};
const labels: Record<ConnectionStatus, string> = { connected: "Connected", authentication_required: "Authentication required", workbook_inaccessible: "Workbook inaccessible", permission_denied: "Permission denied", invalid_spreadsheet_link: "Invalid spreadsheet link" };
const headers = "MKSS Key, Record Type, Record Code, Name, Status, Timestamp, Details, Updated At";
const date = siteDateTime;
const selectedValue = (kind: string, id: string) => `${kind}:${id}`;

export default function ExcelIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [testStatus, setTestStatus] = useState<ConnectionStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Status>("microsoft/status");
      setStatus(data);
      setTarget(data.connection?.selected_target_kind && data.connection.selected_target_id ? selectedValue(data.connection.selected_target_kind, data.connection.selected_target_id) : "");
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const result = new URLSearchParams(location.search).get("excel") as ConnectionStatus | null;
    if (result && result in labels) {
      setTestStatus(result);
      setMessage(result === "connected" ? "Microsoft authenticated. Select a worksheet or table below." : `Microsoft connection: ${labels[result]}.`);
    }
  }, [load]);

  async function connect() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ url: string }>("microsoft/connect", { method: "POST", body: JSON.stringify({ share_url: shareUrl || undefined }) });
      location.href = result.url;
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  }

  async function saveTarget() {
    const choice = status?.destinations.find(item => selectedValue(item.kind, item.id) === target);
    if (!choice) { setError("Select a worksheet or table."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ queued: number }>("microsoft/target", { method: "POST", body: JSON.stringify({ kind: choice.kind, id: choice.id }) });
      setTestStatus(null);
      setMessage(`${choice.name} selected. ${result.queued} existing records queued for Excel sync.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ status: ConnectionStatus; message?: string }>("microsoft/test", { method: "POST" });
      setTestStatus(result.status);
      setMessage(result.status === "connected" ? "Connection test passed. MKSS can open the selected workbook." : result.message || labels[result.status]);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setError(""); setMessage("");
    try {
      await api("microsoft/disconnect", { method: "DELETE" });
      setShareUrl(""); setTarget(""); setTestStatus("authentication_required"); setMessage("Microsoft disconnected. MKSS records will remain in Supabase and Excel changes will wait for a new connection.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ synced: number; failed: number; waiting?: boolean }>("microsoft/retry", { method: "POST" });
      setMessage(result.waiting ? "Excel sync is waiting for a connected workbook and destination." : `Sync run finished: ${result.synced} synced, ${result.failed} pending for retry.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  const displayedStatus = testStatus || status?.status || "authentication_required";
  const readyToSync = status?.status === "connected" && Boolean(status.connection?.selected_target_id);
  return <section className="microsoft-settings" aria-labelledby="microsoft-heading">
    <div className="microsoft-heading"><div><span className="eyebrow">SPREADSHEET CONNECTION</span><h2 id="microsoft-heading">Microsoft Excel / OneDrive</h2><p>Supabase stores every MKSS transaction. A selected workbook receives a reporting copy.</p></div><span className={`badge ${displayedStatus === "connected" ? "connected" : "failed"}`}>{labels[displayedStatus]}</span></div>
    {error && <div className="notice error">{error}</div>}
    {message && <div className={`notice ${displayedStatus === "connected" ? "success" : "error"}`}>{displayedStatus === "connected" && <Check size={17}/>} {message}</div>}
    {loading && <div className="notice"><Loader2 className="spin" size={17}/> Checking Microsoft connection…</div>}
    {status && !status.setup.ready && <div className="notice error"><div><strong>Microsoft app setup required</strong><p>Set these server environment values and register <code>APP_URL/api/microsoft/callback</code> as the Entra web redirect URI.</p><div className="microsoft-missing">{status.setup.missing.map(name => <code key={name}>{name}</code>)}{status.setup.issues.map(issue => <span key={issue}>{issue}</span>)}</div></div></div>}
    <div className="panel microsoft-connection-card"><label htmlFor="spreadsheet-link">Microsoft Excel / OneDrive Spreadsheet Link</label><input id="spreadsheet-link" type="url" inputMode="url" placeholder="Paste an Excel Online, OneDrive, or SharePoint sharing URL" value={shareUrl} onChange={event => setShareUrl(event.target.value)}/><p>Use a sharing link to an Excel workbook that the Microsoft account can edit. No drive, workbook, worksheet, or table IDs are needed.</p><div className="microsoft-actions"><button className="button primary" onClick={connect} disabled={busy || loading || !status?.setup.ready || (!shareUrl.trim() && !status?.connection)}>{busy ? <Loader2 className="spin" size={17}/> : <Link2 size={17}/>} Connect Microsoft</button><button className="button secondary" onClick={testConnection} disabled={busy || loading || !status?.connection}><RefreshCw size={16}/> Test Connection</button>{status?.connection && <button className="button secondary" onClick={disconnect} disabled={busy}><Unplug size={16}/> Disconnect Microsoft</button>}</div></div>
    {status?.connection && <div className="panel microsoft-workbook"><div className="row between"><div><span className="eyebrow">DETECTED WORKBOOK</span><h3>{status.connection.workbook_name || "Excel workbook"}</h3></div>{status.connection.workbook_web_url && <a href={status.connection.workbook_web_url} target="_blank" rel="noopener noreferrer">Open workbook <ArrowUpRight size={15}/></a>}</div>{status.connectionError && <div className="notice error">{status.connectionError}</div>}
      {status.destinations.length > 0 && <div className="microsoft-target"><label htmlFor="excel-destination">Synchronize MKSS records to</label><select id="excel-destination" value={target} onChange={event => setTarget(event.target.value)}><option value="">Select a worksheet or table</option><optgroup label="Worksheets">{status.destinations.filter(item => item.kind === "worksheet").map(item => <option key={`sheet-${item.id}`} value={selectedValue(item.kind, item.id)}>{item.name}</option>)}</optgroup><optgroup label="Excel tables">{status.destinations.filter(item => item.kind === "table").map(item => <option key={`table-${item.id}`} value={selectedValue(item.kind, item.id)}>{item.name} · {item.worksheetName}</option>)}</optgroup></select><p>Empty worksheets receive MKSS columns automatically. An existing table must have: {headers}.</p>{!status.connection.selected_target_id && <div className="notice">Choose and save a destination to start Excel synchronization.</div>}<button className="button primary" disabled={busy || !target || target === selectedValue(status.connection.selected_target_kind || "", status.connection.selected_target_id || "")} onClick={saveTarget}><Check size={16}/> Save destination</button></div>}
    </div>}
    <div className="panel"><div className="panel-head"><div><span className="eyebrow">EXCEL DELIVERY</span><h2>Synchronization queue</h2></div><button className="button secondary" onClick={syncNow} disabled={busy || !readyToSync}><RefreshCw size={17}/> Sync now</button></div>{status?.queue?.length ? <div className="table-scroll"><table><thead><tr><th>Record</th><th>Status</th><th>Attempts</th><th>Last sync</th><th>Error</th></tr></thead><tbody>{status.queue.map(item => <tr key={item.id}><td>{item.entity_type.replaceAll("_", " ")}</td><td><span className={`badge ${item.sync_status}`}>{item.sync_status.toUpperCase()}</span></td><td>{item.sync_attempts}</td><td>{date(item.last_sync_time)}</td><td className="error-cell">{item.last_sync_error || "—"}</td></tr>)}</tbody></table></div> : <div className="empty"><h3>No queued Excel updates</h3><p>New MKSS records will wait here until they can be synchronized.</p></div>}</div>
  </section>;
}
