"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { siteDateTime } from "@/lib/date";
type Data = { driver: { driver_code: string; registration_status: string; last_active_at: string | null }; history: { registration_version: number; registered_at: string; expired_at: string | null; status: string; details: Record<string, unknown> }[] };
export default function DriverRegistrationHistory({ driverId, name, onClose }: { driverId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  useEffect(() => { api<Data>(`driver-history?driver_id=${driverId}`).then(setData).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }, [driverId]);
  return <div className="modal-backdrop"><div className="modal"><h2>{name} · Registration history</h2><button className="button secondary" onClick={onClose}>Close</button>{error && <div className="notice error">{error}</div>}{!data ? <p>Loading history…</p> : <><p>{data.driver.driver_code} · {data.driver.registration_status}<br/>Last activity: {siteDateTime(data.driver.last_active_at)}</p>{data.history.map(row => <section key={row.registration_version}><h3>Registration #{row.registration_version} · {row.status}</h3><p>Registered: {siteDateTime(row.registered_at)}<br/>Expired: {siteDateTime(row.expired_at)}</p><p>{String(row.details.name || row.details.full_name || name)} · {String(row.details.company || row.details.requested_company || "")}{row.details.vehicle ? ` · ${row.details.vehicle}` : ""}</p></section>)}</>}</div></div>;
}
