import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { archiveGrid, archiveCsv, archiveXlsx, exportValue, snoozeHours, storageBand, type ArchiveRow } from "./archive-format";
describe("archive capacity warnings", () => {
  it("escalates snoozes and disallows dismissing emergency usage", () => {
    expect([89.9, 90, 91.99, 92, 93.99, 94, 120].map(storageBand)).toEqual([0,90,90,92,92,94,94]);
    expect([89,90,92,94].map(snoozeHours)).toEqual([0,24,6,0]);
  });
});
describe("portable archive reports", () => {
  const rows: ArchiveRow[] = [{ record: { id: "internal-id", driver_id: "internal-driver", visit_code: "internal-code", company_time_in: "2026-01-01T01:00:00Z", company_time_out: "2026-01-01T05:00:00Z" }, hash: "fingerprint", context: { driver: 'A & "B"', identity_reference: "0000123", company: " =HYPERLINK(1)", vehicle: "ABC 1234" } }];
  it("preserves IC leading zeros, escapes CSV cells and prevents formula injection", () => {
    const csv = archiveCsv(rows);
    expect(csv).toContain('"0000123"'); expect(csv).toContain('"A & ""B"""');
    expect(csv).toContain("' =HYPERLINK(1)"); expect(csv).not.toContain("context_driver");
    expect(exportValue(rows[0].record.company_time_in)).toMatch(/9:00 am MYT/);
    expect(rows[0].record.company_time_in).toBe("2026-01-01T01:00:00Z");
  });
  it("exports only the requested lorry columns with real Malaysia timestamps", () => {
    const [headers, values] = archiveGrid(rows);
    expect(headers).toEqual(["Time in (MYT)", "Time out (MYT)", "Lorry number", "Company name", "Driver IC", "Driver name"]);
    expect(values[0]).toMatch(/9:00 am MYT/); expect(values[1]).toMatch(/1:00 pm MYT/);
    for (const internal of ["internal-id", "internal-driver", "internal-code", "fingerprint"]) expect(archiveCsv(rows)).not.toContain(internal);
    expect(archiveGrid([{ ...rows[0], record: {} }])[1].slice(0, 2)).toEqual(["", ""]);
  });
  it("exports only contractor name, IC/passport and company without extra fields", () => {
    const contractors: ArchiveRow[] = [{ record: { id: "attendance-id", contractor_id: "contractor-id", pass_id: "pass", time_in: "2026-01-01T01:00:00Z" }, context: { name: "Contractor Test", identity_reference: "001234", company: "Test Services", work_type: "IT" }, hash: "hash" }];
    expect(archiveGrid(contractors, "contractor_attendance")).toEqual([["Name", "IC / Passport number", "Company name"], ["Contractor Test", "001234", "Test Services"]]);
    const sheet = strFromU8(unzipSync(archiveXlsx(contractors, "contractor_attendance"))["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("001234"); expect(sheet).not.toContain("attendance-id"); expect(sheet).not.toContain("work_type");
  });
  it("generates an XLSX package with literal strings, frozen headers and a filter", () => {
    const files = unzipSync(archiveXlsx(rows)), sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(files["[Content_Types].xml"]).toBeDefined();
    expect(sheet).toContain('t="inlineStr"'); expect(sheet).toContain("0000123");
    expect(sheet).toContain("A &amp; &quot;B&quot;"); expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('state="frozen"'); expect(sheet).toContain("autoFilter");
  });
});
