import { describe, expect, it } from "vitest";
import { signup } from "./driver-registration";

const valid = {
  email: "driver@example.com", password: "a-long-passphrase-123",
  full_name: "Test Driver", phone: "+60123456789", licence_number: "D1234567",
  requested_company: "Test Transport", requested_lorry: "abc 1234",
  requested_vehicle_type: "Box lorry",
};

describe("driver signup details", () => {
  it("requires the driving licence, company, vehicle registration and type", () => {
    for (const field of ["licence_number", "requested_company", "requested_lorry", "requested_vehicle_type"] as const) {
      expect(signup.safeParse({ ...valid, [field]: "" }).success).toBe(false);
    }
  });

  it("normalizes the email and registration and accepts optional contact details", () => {
    const result = signup.parse({ ...valid, email: "DRIVER@EXAMPLE.COM",
      company_contact_person: "Dispatcher", company_phone: "+60122223333" });
    expect(result.email).toBe("driver@example.com");
    expect(result.requested_lorry).toBe("ABC 1234");
    expect(result.company_contact_person).toBe("Dispatcher");
  });
});
