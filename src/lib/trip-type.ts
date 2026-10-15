export type TripType = "Hantar Barang" | "Ambil Barang" | "Manual";

export function tripDeadline(timeIn: string | null, tripType: TripType) {
  if (!timeIn) return null;
  const duration = tripType === "Manual" ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000;
  return new Date(new Date(timeIn).getTime() + duration).toISOString();
}
