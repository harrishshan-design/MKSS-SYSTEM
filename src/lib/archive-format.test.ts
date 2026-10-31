import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { archiveCsv, archiveXlsx, exportValue, snoozeHours, storageBand, type ArchiveRow } from "./archive-format";
describe("archive capacity warnings", () => {
  it("escalates snoozes and disallows dismissing emergency usage", () => {
    expect([89.9, 90, 91.99, 92, 93.99, 94, 120].map(storageBand)).toEqual([0,90,90,92,92,94,94]);
    expect([89,90,92,94].map(snoozeHours)).toEqual([0,24,6,0]);
  });
});
describe("portable archive reports", () => {
  const rows: ArchiveRow[] = [{ record: { id: "0000123", name: 'A & "B"', company_time_in: "2026-01-01T01:00:00Z", note: " =HYPERLINK(1)" }, hash: "fingerprint", context: { driver: "Driver Test" } }];
  it("preserves original identifiers, escapes CSV cells and prevents formula injection", () => {
    const csv = archiveCsv(rows);
    expect(csv).toContain('"0000123"'); expect(csv).toContain('"A & ""B"""');
    expect(csv).toContain("' =HYPERLINK(1)"); expect(csv).toContain("context_driver");
    expect(exportValue(rows[0].record.company_time_in)).toMatch(/9:00 am MYT/);
    expect(rows[0].record.company_time_in).toBe("2026-01-01T01:00:00Z");
  });
  it("generates an XLSX package with literal strings, frozen headers and a filter", () => {
    const files = unzipSync(archiveXlsx(rows)), sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(files["[Content_Types].xml"]).toBeDefined();
    expect(sheet).toContain('t="inlineStr"'); expect(sheet).toContain("0000123");
    expect(sheet).toContain("A &amp; &quot;B&quot;"); expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('state="frozen"'); expect(sheet).toContain("autoFilter");
  });
});
