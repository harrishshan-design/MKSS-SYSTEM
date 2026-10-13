import { z } from "zod";

export const driverDetails = z.object({
  email: z.string().trim().max(254).refine(value => !value || z.email().safeParse(value).success, "Enter a valid email address")
    .optional().nullable().transform(value => value?.toLowerCase() || null),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  identity_reference: z.string().trim().min(6).max(30),
  requested_company: z.string().trim().min(2).max(120),
  requested_lorry: z.string().trim().min(2).max(40).transform(value => value.toUpperCase()),
  has_driving_licence: z.boolean(),
  trip_type: z.enum(["Hantar Barang", "Ambil Barang", "Manual"]),
});

export const signup = driverDetails;

export function vehicleLoginKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function internalDriverEmail(id: string) {
  return `driver-${id}@login.mkss.invalid`;
}
