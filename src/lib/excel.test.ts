import { describe, expect, it } from "vitest";
import { exportRow, processSyncQueue } from "./excel";

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

  it("never includes the driver QR signing secret in reporting rows", () => {
    const row = exportRow("drivers", "driver-id", { id: "driver-id", full_name: "Driver", qr_token: "private-qr-secret", active: true });
    expect(String(row[6])).not.toContain("private-qr-secret");
    expect(JSON.parse(String(row[6]))).not.toHaveProperty("QR ID");
  });
});

describe("optional Excel synchronization", () => {
  it("leaves queued work waiting when Microsoft is not configured", async () => {
    const saved = process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
    try {
      await expect(processSyncQueue()).resolves.toEqual({ synced: 0, failed: 0, waiting: true });
    } finally {
      if (saved === undefined) delete process.env.MICROSOFT_CLIENT_ID;
      else process.env.MICROSOFT_CLIENT_ID = saved;
    }
  });
});
