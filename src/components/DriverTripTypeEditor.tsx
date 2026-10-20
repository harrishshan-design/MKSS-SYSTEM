"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { TripType } from "@/lib/trip-type";

export default function DriverTripTypeEditor({ driver, onClose, onSaved }: {
  driver: { id: string; full_name: string; default_trip_type: TripType | null };
  onClose: () => void;
  onSaved: (updatedOpenTrips: number) => void;
}) {
  const [tripType, setTripType] = useState<TripType | "">(driver.default_trip_type || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!tripType) return;
    setSaving(true); setError("");
    try {
      const result = await api<{ updated_open_trips: number }>("driver-trip-type", {
        method: "PATCH", body: JSON.stringify({ driver_id: driver.id, trip_type: tripType }),
      });
      onSaved(result.updated_open_trips);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  }

  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-header"><div><span className="eyebrow">APPROVED DRIVER</span><h2>Correct trip type</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></div>
    <p>Update {driver.full_name}&apos;s loading type. The driver screen and future QR trips will use the corrected type. Any open QR trip will also be updated; completed trips keep their history.</p>
    {error && <div className="notice error">{error}</div>}
    <form onSubmit={save} className="form-grid">
      <label className="full">Trip type<select required value={tripType} onChange={event => setTripType(event.target.value as TripType)}>
        <option value="">Select type</option>
        <option value="Ambil Barang">Ambil Barang · loading · 30 min</option>
        <option value="Hantar Barang">Hantar Barang · unloading · 30 min</option>
        <option value="Manual">Manual loading · 2 hours</option>
        <option value="Tank Farm">Tank Farm · 2 hours</option>
        <option value="RORO Biru">RORO Biru · 30 min</option>
        <option value="RORO Oren">RORO Oren · 30 min</option>
      </select></label>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="button primary" disabled={saving || !tripType}>{saving ? <Loader2 className="spin" size={16}/> : <Check size={16}/>} Save type</button></div>
    </form>
  </div></div>;
}
