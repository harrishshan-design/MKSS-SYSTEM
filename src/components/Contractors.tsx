"use client";
import { useCallback, useState } from "react";
import { Users } from "lucide-react";
import { api } from "@/lib/client-api";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { WORK_TYPES } from "@/lib/contractors";
import { siteDate, siteDateTime } from "@/lib/date";
type Person = { id: string; full_name: string; identity_reference?: string; company_name: string; work_type: string; status: string };
type Attendance = { id: string; full_name: string; company_name: string; work_type: string; time_in: string; time_out: string | null };
type Data = { metrics: { total: number; pending: number; approved: number; inside: number; attendance_today: number }; contractors: Person[]; attendance: Attendance[] };

export default function Contractors({ summary = false, canEdit = false }: { summary?: boolean; canEdit?: boolean }) {
  const [data, setData] = useState<Data | null>(null), [draft, setDraft] = useState<Person | null>(null), [error, setError] = useState(""), [saving, setSaving] = useState(false), [search, setSearch] = useState("");
  const load = useCallback(async () => { try { setData(await api<Data>(`contractors${summary ? "?summary=1" : ""}`)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, [summary]);
  useLiveRefresh(load, { resources: ["contractors"] });
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return; setSaving(true); setError("");
    try { await api("contractors", { method: "PATCH", body: JSON.stringify(draft) }); setDraft(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  function exportAttendance() {
    if (!data) return;
    const cell = (value: string) => `"${(/^[=+\-@]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
    const rows = [["Date", "Contractor", "Company", "Work type", "Time in (MYT)", "Time out (MYT)"], ...data.attendance.map(a => [siteDate(), a.full_name, a.company_name, a.work_type, siteDateTime(a.time_in), a.time_out ? siteDateTime(a.time_out) : ""])];
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `mkss-contractors-${siteDate()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (summary) return <div className="metric"><div className="metric-icon green"><Users size={21}/></div><div className="metric-label">Contractor inside</div><div className="metric-value" aria-live="polite">{error ? "—" : data?.metrics.inside ?? "—"}</div><div className="metric-note" title={error || undefined}>{error ? "Connection unavailable" : "Clocked in today"}</div></div>;
  return <section className="panel settings-panel contractor-panel"><div className="row between"><div><span className="eyebrow">CONTRACTORS · SEPARATE ATTENDANCE</span><h2>Contractors</h2><p>Contractor registrations and attendance are recorded separately from lorry trips.</p></div>{!summary && <button className="button secondary" onClick={exportAttendance} disabled={!data?.attendance.length}>Export today CSV</button>}</div>
    {error && <div className="notice error">{error}</div>}
    {!data ? <p>Loading contractors…</p> : <><div className="live-summary">{[["Registered", data.metrics.total], ["Active", data.metrics.approved], ["Inside today", data.metrics.inside], ["Attendance today", data.metrics.attendance_today]].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
      {!summary && <><input className="gate-search" aria-label="Search contractors" placeholder="Search contractor, company or work type" value={search} onChange={e => setSearch(e.target.value)}/>
        <h3>Registered contractors</h3><p className="muted">Latest 1,000 registrations. Directory IC details are visible to administrators only.</p><div className="table-scroll"><table><thead><tr>{["Name", "Company", "Work type", "Status", ...(canEdit ? ["Actions"] : [])].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.contractors.filter(p => `${p.full_name} ${p.company_name} ${p.work_type}`.toLowerCase().includes(search.toLowerCase())).map(p => <tr key={p.id}><td>{p.full_name}</td><td>{p.company_name}</td><td>{p.work_type}</td><td>{p.status}</td>{canEdit && <td><button className="mini-button" onClick={() => setDraft(p)}>{p.status === "PENDING" ? "Review / approve" : "Edit"}</button></td>}</tr>)}</tbody></table>{!data.contractors.length && <p>No contractor registrations yet.</p>}</div>
        <h3>Today&apos;s contractor attendance · {data.metrics.attendance_today}</h3><p className="muted">Latest 1,000 records for {siteDate()}. This export contains the displayed contractor attendance only.</p><div className="table-scroll"><table><thead><tr>{["Name", "Company", "Work type", "Time in", "Time out"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.attendance.map(a => <tr key={a.id}><td>{a.full_name}</td><td>{a.company_name}</td><td>{a.work_type}</td><td>{siteDateTime(a.time_in)}</td><td>{a.time_out ? siteDateTime(a.time_out) : "Inside"}</td></tr>)}</tbody></table>{!data.attendance.length && <p>No contractor attendance today.</p>}</div></>}
    </>}
    {draft && <div className="modal-backdrop"><div className="modal"><h2>Edit contractor</h2>{error && <div className="notice error">{error}</div>}<form className="form-grid" onSubmit={save}>
      <label>Name<input required minLength={2} maxLength={120} value={draft.full_name} onChange={e => setDraft({ ...draft, full_name: e.target.value })}/></label>
      <label>IC number<input readOnly value={draft.identity_reference || "Restricted"}/></label>
      <label>Company name<input required minLength={2} maxLength={120} value={draft.company_name} onChange={e => setDraft({ ...draft, company_name: e.target.value })}/></label>
      <label>Work type<select value={draft.work_type} onChange={e => setDraft({ ...draft, work_type: e.target.value })}>{WORK_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
      <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{["PENDING", "APPROVED", "REJECTED", "INACTIVE"].map(s => <option key={s}>{s}</option>)}</select></label>
      <div className="modal-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
    </form></div></div>}
  </section>;
}
