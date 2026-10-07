import { z } from "zod";

export const driverDetails = z.object({
  email: z.email().max(254).transform(value => value.trim().toLowerCase()),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  identity_reference: z.string().trim().min(6).max(30),
  requested_company: z.string().trim().min(2).max(120),
  has_driving_licence: z.boolean(),
  trip_type: z.enum(["Hantar Barang", "Ambil Barang"]),
});

export const signup = driverDetails.extend({ password: z.string().min(12).max(128) });
