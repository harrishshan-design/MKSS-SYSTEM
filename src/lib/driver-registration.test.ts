import { describe, expect, it } from "vitest";
import { signup, vehicleLoginKey } from "./driver-registration";

const valid = {
  email: "driver@example.com",
  full_name: "Test Driver", phone: "+60123456789", identity_reference: "900101101234",
  requested_company: "Test Transport", requested_lorry: "BPK 1234", has_driving_licence: true, trip_type: "Hantar Barang",
};

describe("driver signup details", () => {
  it("requires the driver and vehicle details and accepts either licence answer", () => {
    for (const field of ["full_name", "identity_reference", "phone", "requested_company", "requested_lorry"] as const)
      expect(signup.safeParse({ ...valid, [field]: "" }).success).toBe(false);
    expect(signup.safeParse({ ...valid, has_driving_licence: false }).success).toBe(true);
    expect(signup.safeParse({ ...valid, has_driving_licence: "No" }).success).toBe(false);
    expect(signup.safeParse({ ...valid, trip_type: "Manual" }).success).toBe(true);
    expect(signup.safeParse({ ...valid, trip_type: "Tank Farm" }).success).toBe(true);
    expect(signup.safeParse({ ...valid, trip_type: "RORO Biru" }).success).toBe(true);
    expect(signup.safeParse({ ...valid, trip_type: "RORO Oren" }).success).toBe(true);
    expect(signup.safeParse({ ...valid, trip_type: "Other" }).success).toBe(false);
  });

  it("normalizes the email and vehicle number", () => {
    const result = signup.parse({ ...valid, email: "DRIVER@EXAMPLE.COM", requested_lorry: "bpk 1234" });
    expect(result.email).toBe("driver@example.com");
    expect(result.requested_lorry).toBe("BPK 1234");
    expect(result.trip_type).toBe("Hantar Barang");
  });

  it("requires a valid IC number, which becomes the initial password", () => {
    expect(signup.safeParse({ ...valid, identity_reference: "12345" }).success).toBe(false);
    expect(signup.safeParse({ ...valid, identity_reference: "900101101234" }).success).toBe(true);
  });

  it("requires email at signup and still normalizes vehicle login", () => {
    expect(signup.safeParse({ ...valid, email: "" }).success).toBe(false);
    expect(signup.safeParse({ ...valid, email: undefined }).success).toBe(false);
    expect(signup.safeParse({ ...valid, email: "invalid" }).success).toBe(false);
    expect(vehicleLoginKey("bpk-1234")).toBe(vehicleLoginKey("BPK 1234"));
  });
});
