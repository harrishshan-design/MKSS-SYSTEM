import { z } from "zod";

export const driverDetails = z.object({
  email: z.email().max(254).transform(value => value.trim().toLowerCase()),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  licence_number: z.string().trim().min(2).max(80),
  identity_reference: z.string().trim().max(80).optional().default(""),
  requested_company: z.string().trim().min(2).max(120),
  company_contact_person: z.string().trim().max(120).optional().default(""),
  company_phone: z.string().trim().max(30).optional().default(""),
  company_email: z.union([z.literal(""), z.email().max(254)]).optional().default(""),
  requested_lorry: z.string().trim().min(2).max(40).transform(value => value.toUpperCase()),
  requested_vehicle_type: z.string().trim().min(2).max(80),
});

export const signup = driverDetails.extend({ password: z.string().min(12).max(128) });
