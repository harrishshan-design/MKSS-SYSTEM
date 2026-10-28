import { describe, expect, it } from "vitest";
import { contractorIc, contractorSignup, WORK_TYPES } from "./contractors";
describe("separate contractor registration", () => {
  const valid = { full_name: "Contractor Test", identity_reference: "900101-10-1234", company_name: "Test Services", work_type: "IT" };
  it("normalizes IC-based sign-in and accepts all four work types", () => {
    expect(contractorIc.parse("900101-10-1234")).toBe("900101101234");
    for (const work_type of WORK_TYPES) expect(contractorSignup.parse({ ...valid, work_type }).work_type).toBe(work_type);
  });
  it("requires all requested fields and rejects driver trip types", () => {
    for (const key of Object.keys(valid)) expect(contractorSignup.safeParse({ ...valid, [key]: "" }).success).toBe(false);
    expect(contractorSignup.safeParse({ ...valid, work_type: "Ambil Barang" }).success).toBe(false);
    expect(contractorSignup.safeParse({ ...valid, identity_reference: "not-an-ic" }).success).toBe(false);
  });
  it("does not accept a vehicle or driver assignment as contractor data", () => {
    const result = contractorSignup.parse({ ...valid, driver_id: "driver", requested_lorry: "ABC1234", role: "admin", status: "APPROVED" });
    expect(result).not.toHaveProperty("driver_id");
    expect(result).not.toHaveProperty("role");
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("requested_lorry");
  });
});
