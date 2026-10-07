import { z } from "zod";
import { adminClient } from "@/lib/supabase";
import { insideFence } from "@/lib/geofence";
import { ApiError } from "@/lib/api";
import type { Fence, Position } from "@/lib/types";

export const sitePosition = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1000),
  timestamp: z.iso.datetime(),
});

export async function requireOnSitePosition(input: z.infer<typeof sitePosition>) {
  const observedAt = new Date(input.timestamp).getTime();
  if (Math.abs(Date.now() - observedAt) > 120_000)
    throw new ApiError(422, "Location is out of date. Retry with live GPS at the gate.");
  if (input.accuracy > 80)
    throw new ApiError(422, "GPS accuracy is too low. Move outdoors and try again.");
  const { data, error } = await adminClient().from("geofences").select("*").eq("kind", "company").eq("enabled", true).single();
  if (error || !data) throw new ApiError(503, "The site boundary is unavailable. Ask an administrator to check Site settings.");
  const result = insideFence(input as Position, data as Fence);
  if (!result.inside) throw new ApiError(403, "You must be within the site boundary to scan the daily QR.");
  return { distance_meters: Math.round(result.distance), accuracy_meters: input.accuracy };
}
