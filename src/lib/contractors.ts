import { z } from "zod";
export const WORK_TYPES = ["IT", "Warehouse", "Maintenance", "Safety"] as const;
export const contractorIc = z.string().trim().transform(value => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{12}$/, "Enter your 12-digit IC number"));
export const contractorDetails = z.object({
  full_name: z.string().trim().min(2).max(120), company_name: z.string().trim().min(2).max(120),
  work_type: z.enum(WORK_TYPES),
});
export const contractorSignup = contractorDetails.extend({ identity_reference: contractorIc });
