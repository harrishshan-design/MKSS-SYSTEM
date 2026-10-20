export const TRIP_TYPES = [
  "Hantar Barang",
  "Ambil Barang",
  "Manual",
  "Tank Farm",
  "RORO Biru",
  "RORO Oren",
] as const;

export type TripType = typeof TRIP_TYPES[number];

export function tripDeadline(timeIn: string | null, tripType: TripType) {
  if (!timeIn) return null;
  const duration = tripType === "Manual" || tripType === "Tank Farm"
    ? 2 * 60 * 60 * 1000
    : 30 * 60 * 1000;
  return new Date(new Date(timeIn).getTime() + duration).toISOString();
}
