import { z } from "zod";
export const WORK_TYPES = ["IT", "Warehouse", "Maintenance", "Safety"] as const;
export const contractorIc = z.string().trim().transform(value => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6,12}$/, "Enter a 6–12 digit IC or passport number"));
export const contractorDetails = z.object({
  full_name: z.string().trim().min(2).max(120), company_name: z.string().trim().min(2).max(120),
  work_type: z.enum(WORK_TYPES),
});
export const contractorSignup = contractorDetails.extend({ identity_reference: contractorIc });
export const contractorAttendanceScan = z.object({
  token: z.string().max(160), action: z.enum(["in", "out"]),
  pass_id: z.string().trim().max(80, "Pass ID must be 80 characters or fewer").optional(),
}).superRefine((value, ctx) => {
  if (value.action === "in" && !value.pass_id)
    ctx.addIssue({ code: "custom", path: ["pass_id"], message: "Enter your Pass ID before clocking in" });
});
