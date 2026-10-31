"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { publicClient } from "@/lib/supabase";
import { snoozeHours, storageBand } from "@/lib/archive-format";
type Batch = { id: string; archive_number: string; status: string; cutoff: string; period_start: string | null; period_end: string | null; record_count: number; deleted_count: number; retained_count: number; stored_bytes: number; resource_counts: Record<string, number>; files_removed_at: string | null; downloaded_at: string | null; bytes_before: number; bytes_after: number | null; error: string | null };
type Data = { health: { measured_bytes: number; measured_at: string; limit_bytes: number; snoozed_until: string | null; snoozed_band: number | null }; batches: Batch[]; counts: { drivers: number; vehicles: number; visits: number }; oldest: string | null };
const mb = (value: number) => (value / 1024 / 1024).toFixed(1);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" }) : "—";
export default function DatabaseHealth({ expanded, onOpen }: { expanded: boolean; onOpen: () => void }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [limit, setLimit] = useState(500), [message, setMessage] = useState("");
  const running = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => { if (running.current) return; try { const next = await api<Data>("archives"); if (mounted.current) { setData(next); setLimit(next.health.limit_bytes / 1024 / 1024); setError(""); } } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); } }, []);
  useEffect(() => { mounted.current = true; void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 300_000); return () => { mounted.current = false; clearInterval(timer); }; }, [load]);
  useEffect(() => { if (expanded) void load(); }, [expanded, load]);
  async function work(action: string, batchId?: string) {
    running.current = true; setBusy(true); setError(""); setMessage("");
    try {
      let next = await api<Data>("archives", { method: "POST", body: JSON.stringify({ action, ...(batchId ? { batch_id: batchId } : {}), ...(action === "confirm" ? { saved: true } : {}), ...(action === "remove_online" ? { saved_copies: true } : {}), ...(action === "budget" ? { limit_mb: limit } : {}) }) });
      if (mounted.current) setData(next);
      if (["start", "step", "confirm"].includes(action)) {
        for (;;) {
          const batch = next.batches.find(b => ["EXPORTING", "CLEANING"].includes(b.status));
          if (!batch || !mounted.current) break;
          next = await api<Data>("archives", { method: "POST", body: JSON.stringify({ action: "step", batch_id: batch.id }) });
          if (mounted.current) setData(next);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (["start", "step"].includes(action) && mounted.current) {
        const ready = next.batches.find(batch => batch.status === "READY" && (!batchId || batch.id === batchId));
        if (ready) await download(ready);
      }
      setSaved(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function download(batch: Batch) {
    running.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const session = await publicClient().auth.getSession();
      const response = await fetch(`/api/archives/download?batch_id=${batch.id}`, { headers: { Authorization: `Bearer ${session.data.session?.access_token || ""}` } });
      if (!response.ok) throw new Error((await response.json()).error || "Archive download failed");
      const file = await response.blob(); // No Done button until the entire stream succeeds.
      const url = URL.createObjectURL(file), link = document.createElement("a"); link.href = url;
      link.download = `MKSS_${batch.archive_number}_${batch.cutoff.slice(0, 10)}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Archive downloaded. Open the ZIP and confirm you have saved the complete file before cleanup.");
      const next = await api<Data>("archives"); if (mounted.current) setData(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const percent = data ? data.health.measured_bytes / data.health.limit_bytes * 100 : 0, band = storageBand(percent);
  const hidden = band !== 94 && data?.health.snoozed_band === band && Date.parse(data.health.snoozed_until || "") > Date.now();
  const current = data?.batches.find(b => ["EXPORTING", "READY", "CLEANING"].includes(b.status));
  const warning = band > 0 && !hidden;
  if (!expanded) return <>{warning && <div className="storage-warning" role="alert"><strong>{band === 94 ? "EMERGENCY STORAGE WARNING" : "DATABASE STORAGE CRITICAL"} · {percent.toFixed(1)}%</strong><p>Archive completed historical records to make room for future operations.</p><div className="row gap archive-actions"><button className="button primary" disabled={busy} onClick={() => { onOpen(); void work("start"); }}>Export Archive</button>{snoozeHours(percent) > 0 && <button className="button secondary" disabled={busy} onClick={() => void work("snooze")}>Ignore for {snoozeHours(percent)} hours</button>}</div>{error && <p>{error}</p>}</div>}</>;
  return <><div className="page-header"><div><span className="eyebrow">DATABASE HEALTH</span><h1>Storage & archives</h1><p>Archive transactions and start a new cycle. Master records and account IDs stay in MKSS.</p></div></div>
    {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success">{message}</div>}
    {!data ? <p>Checking database storage…</p> : <><section className="panel settings-panel"><h2>{band === 94 ? "Emergency storage warning" : band ? "Database storage critical" : "Database health"} · {percent.toFixed(1)}%</h2><progress max={100} value={Math.min(percent, 100)} aria-label="Database usage" style={{ width: "100%" }}/><p>{mb(data.health.measured_bytes)} MB / {mb(data.health.limit_bytes)} MB configured database allowance. Measured {date(data.health.measured_at)}.</p>
      <div className="live-summary">{[["Visits stored", data.counts.visits], ["Drivers retained", data.counts.drivers], ["Vehicles retained", data.counts.vehicles], ["Oldest visit", date(data.oldest)]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <p>Exports contain XLSX and CSV parts plus original JSON records in one ZIP. Today&apos;s records, open attendance/trips, unverified timed-out exits, registration history, accounts, QR identities and configuration remain in MKSS.</p>
      <div className="row gap archive-actions"><button className="button primary" disabled={busy || Boolean(current)} onClick={() => void work("start")}>Export Archive</button>{warning && snoozeHours(percent) > 0 && <button className="button secondary" disabled={busy} onClick={() => void work("snooze")}>Ignore for {snoozeHours(percent)} hours</button>}<button className="button secondary" disabled={busy} onClick={() => void load()}>Refresh</button></div>
      {band === 94 && <p role="alert">Essential operations remain available. This warning cannot be dismissed at 94% or above.</p>}
      <details><summary>Database allowance</summary><p>Set the allowance for your current plan. The default is 500 MB; this setting measures usage and does not change your hosting plan.</p><label>Allowance (MB)<input type="number" min={100} max={10000000} value={limit} onChange={e => setLimit(Number(e.target.value))}/></label><button className="button secondary" disabled={busy} onClick={() => void work("budget")}>Save allowance</button></details>
    </section>
    {current && <section className="panel settings-panel"><h2>{current.archive_number} · {current.status}</h2><p>{current.record_count.toLocaleString()} records exported · {date(current.period_start)} – {date(current.period_end)} · {mb(current.stored_bytes)} MB compressed.</p>
      <p>{Object.entries(current.resource_counts).map(([resource,count])=>`${resource.replaceAll("_"," ")}: ${count.toLocaleString()}`).join(" · ")}</p>
      {busy && <p aria-live="polite">{current.status === "CLEANING" ? `Cleaning exported records… ${current.deleted_count.toLocaleString()} removed.` : "Working… Keep this page open. If interrupted, return here and resume."}</p>}
      {current.error && <div className="notice error">{current.error}</div>}
      {["EXPORTING", "CLEANING"].includes(current.status) && <button className="button primary" disabled={busy} onClick={() => void work("step", current.id)}>Resume {current.status === "CLEANING" ? "cleanup" : "export"}</button>}
      {current.status === "READY" && <><p>Archive ready. Download the ZIP and save it before confirming cleanup.</p><button className="button secondary" disabled={busy} onClick={() => void download(current)}>{current.downloaded_at ? "Download Again" : "Download Archive"}</button>
        {Boolean(current.downloaded_at) && <><label className="archive-confirm"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> I have opened the ZIP and saved the complete archive safely.</label><p>Cleanup permanently removes only unchanged exported records. Keep a second archive copy. Records changed after export are retained.</p><button className="button primary" disabled={busy || !saved} onClick={() => void work("confirm", current.id)}>Done – Archive & Start New Cycle</button></>}
      </>}
    </section>}
    <section className="panel settings-panel"><h2>Archive history</h2><p>Latest 1,000 archive batches. Download completed archives again here. Private archive files use separate file storage; if that storage fills, export stops safely before cleanup. Database space may become reusable without the displayed file size shrinking immediately.</p>
      {data.batches.filter(b => b.status === "COMPLETED").map(batch => <div className="archive-history" key={batch.id}><strong>{batch.archive_number} · Archive completed</strong><p>{batch.deleted_count.toLocaleString()} records removed; {batch.retained_count.toLocaleString()} records skipped (changed, missing or referenced). Database: {mb(batch.bytes_before)} → {mb(batch.bytes_after || 0)} MB.</p>{batch.files_removed_at ? <p>Online copy removed {date(batch.files_removed_at)}. Use your saved archive copies.</p> : <div className="row gap archive-actions"><button className="button secondary" disabled={busy} onClick={() => void download(batch)}>Download Again</button><button className="button secondary" disabled={busy} onClick={() => { if (window.confirm("Permanently remove this completed archive's online files to free file storage? Only continue if you have verified and saved two complete ZIP copies. Download Again will no longer be available. Archive history and master records remain.")) void work("remove_online", batch.id); }}>Remove online copy</button></div>}</div>)}
      {!data.batches.some(b => b.status === "COMPLETED") && <p>No completed archives yet.</p>}
    </section></>}
  </>;
}
