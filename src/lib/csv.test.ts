import { describe, expect, it } from "vitest";
import { csvDocument, csvMalaysiaDateTime } from "./csv";

describe("CSV export", () => {
  it("includes more than 350 records and escapes spreadsheet formulas", () => {
    const rows = Array.from({ length: 351 }, (_, index) => [index, index === 0 ? "=HYPERLINK(\"bad\")" : `Driver ${index}`]);
    const csv = csvDocument(["ID", "Name"], rows);
    expect(csv.split("\r\n")).toHaveLength(353);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });

  it("shows Malaysia visit times with AM/PM and preserves the date across midnight", () => {
    expect(csvMalaysiaDateTime("2026-10-14T01:00:00Z")).toBe("14/10/2026 9:00 AM");
    expect(csvMalaysiaDateTime("2026-10-14T05:00:00Z")).toBe("14/10/2026 1:00 PM");
    expect(csvMalaysiaDateTime("2026-10-14T17:00:00Z")).toBe("15/10/2026 1:00 AM");
    expect(csvMalaysiaDateTime(null)).toBe("");
  });
});
