import { z } from "zod";
import { TRIP_TYPES } from "./trip-type";

export const driverDetails = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  identity_reference: z.string().trim().min(6).max(30),
  requested_company: z.string().trim().min(2).max(120),
  requested_lorry: z.string().trim().min(2).max(40).transform(value => value.toUpperCase()),
  has_driving_licence: z.boolean(),
  trip_type: z.enum(TRIP_TYPES),
});

export const signup = driverDetails;

export function vehicleLoginKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
