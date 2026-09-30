import { describe, expect, it } from "vitest";
import { exportRow } from "./excel";

describe("Excel export rows", () => {
  it("uses a stable key and preserves record details", () => {
    const row = exportRow("companies", "company-id", { id: "company-id", company_code: "COM-000001", name: "Example Logistics", contact_person: "Ari", phone: "123456", email: "ari@example.com", active: true, created_at: "2026-09-30T00:00:00Z" });
    expect(row[0]).toBe("companies:company-id");
    expect(row[1]).toBe("companies");
    expect(row[4]).toBe("ACTIVE");
    expect(JSON.parse(String(row[6]))["Company Name"]).toBe("Example Logistics");
  });

  it("escapes user text that Excel would interpret as a formula", () => {
    const row = exportRow("companies", "company-id", { id: "company-id", company_code: "COM-000001", name: "=HYPERLINK(\"https://example.com\")", active: true });
    expect(row[3]).toBe("'=HYPERLINK(\"https://example.com\")");
  });
});
