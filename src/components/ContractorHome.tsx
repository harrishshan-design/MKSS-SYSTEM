"use client";
import { useCallback, useState } from "react";
import { LogOut, QrCode } from "lucide-react";
import { api } from "@/lib/client-api";
import { publicClient } from "@/lib/supabase";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { siteClockTime } from "@/lib/date";
import Scanner from "@/components/Scanner";
import { INDUCTION_URL, INDUCTION_VERSION, inductionComplete } from "@/lib/contractor-induction";
import type { Actor } from "@/lib/types";

type Data = { person: { full_name: string; company_name: string; work_type: string; status: string; induction_version: string | null; induction_confirmed_at: string | null }; attendance: { pass_id: string | null; time_in: string; time_out: string | null } | null };
export default function ContractorHome({ actorInfo }: { actorInfo: Actor }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [scanning, setScanning] = useState(false), [busy, setBusy] = useState(false);
  const [passId, setPassId] = useState("");
  async function confirmInduction(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await api("contractors/induction", { method: "POST", body: JSON.stringify({ confirmed: true, version: INDUCTION_VERSION }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const load = useCallback(async () => { try { setData(await api<Data>("contractors/me")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useLiveRefresh(load, { resources: ["contractors"], topic: `mkss:contractor:${actorInfo.contractor_id}` });
  const action = data?.attendance ? "out" : "in";
  const onScan = useCallback(async (token: string) => {
    setScanning(false); setBusy(true); setError("");
    try { await api("contractors/me", { method: "POST", body: JSON.stringify({ token, action, ...(action === "in" ? { pass_id: passId.trim() } : {}) }) }); await load(); setPassId(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [action, load, passId]);
  return <div className="driver-shell"><header className="mobile-top"><strong>MKSS · CONTRACTOR</strong><button className="icon-button light-button" aria-label="Sign out" onClick={() => publicClient().auth.signOut()}><LogOut/></button></header>
    <main className="driver-content"><span className="eyebrow">CONTRACTOR ATTENDANCE</span><h1>Hello, {actorInfo.name.split(" ")[0]}.</h1>
      {error && <div className="notice error">{error}</div>}
      {data ? <><p>{data.person.company_name} · {data.person.work_type}</p>
        {data.person.status !== "APPROVED" ? <div className="panel pad"><h2>{data.person.status === "PENDING" ? "Awaiting admin approval" : "Account unavailable"}</h2><p>Status: {data.person.status}. Contact your site administrator before recording attendance.</p></div>
        : !inductionComplete(data.person) && !data.attendance ? <section className="location-card" aria-labelledby="induction-heading">
          <span className="eyebrow">STEP 1 · SAFETY FIRST</span><h2 id="induction-heading">Contractor Safety Induction</h2>
          <p>Complete Premier Centre Group’s safety induction before getting your gate pass and clocking in. You only need to confirm this once for the current induction.</p>
          <a className="button primary full" href={INDUCTION_URL} target="_blank" rel="noopener noreferrer">Open safety induction ↗</a>
          <p>Submit the Google Form in the new tab, then return here.</p>
          <form onSubmit={confirmInduction}>
            <p>By tapping “I agree”, I confirm that I have completed the induction and agree to follow the site safety requirements.</p>
            <p className="muted">This is your declaration. MKSS does not verify the Google Form response.</p>
            <button className="button primary full" disabled={busy}>{busy ? "Saving…" : "I agree — Continue to Pass ID"}</button>
          </form>
        </section> : <div className="location-card"><h2>{data.attendance?.time_out ? "Attendance completed today" : data.attendance ? "You are clocked in" : "Gate pass & time-in"}</h2>
          {inductionComplete(data.person) && <p className="notice">Safety induction confirmed · self-declared</p>}
          <p>Use the same daily or backup site QR displayed for drivers.</p><div className="trip-steps"><div><span>Time in</span><strong>{siteClockTime(data.attendance?.time_in)}</strong></div><div><span>Time out</span><strong>{siteClockTime(data.attendance?.time_out)}</strong></div></div>
          {data.attendance && <p>Pass ID: <strong>{data.attendance.pass_id || "Not recorded"}</strong></p>}
          {!data.attendance?.time_out && <form onSubmit={event => { event.preventDefault(); setScanning(true); }}>{action === "in" && <label>Pass ID<input required maxLength={80} autoComplete="off" placeholder="Enter the pass issued at the gate" value={passId} onChange={event => setPassId(event.target.value)}/></label>}<button className="button primary full" disabled={busy || (action === "in" && !passId.trim())}><QrCode size={20}/>{busy ? "Saving…" : `Scan QR to clock ${action}`}</button></form>}
        </div>}
      </> : <p>Loading your contractor details…</p>}
      {scanning && <Scanner title={`Contractor clock ${action} · scan site QR`} onScan={onScan} onClose={() => setScanning(false)}/>}
    </main></div>;
}
