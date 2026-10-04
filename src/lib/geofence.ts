import type { Fence, Position, Visit, VisitStatus } from "@/lib/types";

export function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude); const lat2 = radians(b.latitude);
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2));
}
export function insideFence(position: Position, fence: Fence) {
  // A point whose uncertainty crosses the boundary is inconclusive.
  const distance = metersBetween(position, fence);
  return { inside: distance + position.accuracy <= fence.radius_meters, outside: distance - position.accuracy > fence.radius_meters, distance };
}
export type GeofenceTransition = { patch: Partial<Visit>; events: string[] };
export function evaluateGeofences(visit: Visit, position: Position, company: Fence, loading: Fence | undefined, exitConfirmationSeconds: number, exitRadiusMeters = company.radius_meters): GeofenceTransition {
  const now = new Date(position.timestamp);
  const patch: Partial<Visit> = { latitude_last: position.latitude, longitude_last: position.longitude, last_location_at: position.timestamp };
  const events: string[] = [];
  if (visit.status === "COMPLETED" || visit.status === "CANCELLED") return { patch: {}, events };
  const main = insideFence(position, company);
  const outsideCheckoutRadius = insideFence(position, { ...company, radius_meters: exitRadiusMeters }).outside;
  const zone = loading?.enabled ? insideFence(position, loading) : null;
  if (main.inside && !visit.company_time_in) {
    patch.company_time_in = position.timestamp; patch.status = "ON_SITE"; events.push("COMPANY_ENTER");
  }
  if (main.inside && visit.exit_pending_at) {
    patch.exit_pending_at = null; patch.status = visit.loading_area_in && !visit.loading_area_out ? "LOADING_UNLOADING" : "ON_SITE"; events.push("COMPANY_EXIT_CANCELLED");
  }
  if (main.inside && zone?.inside && !visit.loading_area_in) {
    patch.loading_area_in = position.timestamp; patch.status = "LOADING_UNLOADING"; events.push("LOADING_ZONE_ENTER");
  }
  if (main.inside && zone?.outside && visit.loading_area_in && !visit.loading_area_out) {
    patch.loading_area_out = position.timestamp; patch.loading_duration_seconds = Math.max(0, Math.round((now.getTime() - new Date(visit.loading_area_in).getTime()) / 1000)); patch.status = "ON_SITE"; events.push("LOADING_ZONE_EXIT");
  }
  if (visit.company_time_in && main.outside) {
    if (!visit.exit_pending_at) { patch.exit_pending_at = position.timestamp; patch.status = "LEAVING"; events.push("COMPANY_EXIT_PENDING"); }
    else if (outsideCheckoutRadius && now.getTime() - new Date(visit.exit_pending_at).getTime() >= exitConfirmationSeconds * 1000) {
      patch.company_time_out = position.timestamp; patch.status = "COMPLETED"; patch.exit_pending_at = null;
      patch.total_duration_seconds = Math.max(0, Math.round((now.getTime() - new Date(visit.company_time_in).getTime()) / 1000));
      if (visit.loading_area_in && !visit.loading_area_out) { patch.loading_area_out = position.timestamp; patch.loading_duration_seconds = Math.max(0, Math.round((now.getTime() - new Date(visit.loading_area_in).getTime()) / 1000)); events.push("LOADING_ZONE_EXIT"); }
      events.push("COMPANY_EXIT_CONFIRMED");
    }
  }
  return { patch, events };
}
export function delayedStatus(visit: Visit, maxMinutes: number, now = Date.now()): VisitStatus | null {
  if (!visit.company_time_in || visit.company_time_out || visit.status === "CANCELLED" || visit.status === "COMPLETED") return null;
  return now - new Date(visit.company_time_in).getTime() > maxMinutes * 60000 ? "DELAYED" : null;
}
