import { describe, expect, it } from "vitest";
import { csvDocument } from "./csv";

describe("CSV export", () => {
  it("includes more than 350 records and escapes spreadsheet formulas", () => {
    const rows = Array.from({ length: 351 }, (_, index) => [index, index === 0 ? "=HYPERLINK(\"bad\")" : `Driver ${index}`]);
    const csv = csvDocument(["ID", "Name"], rows);
    expect(csv.split("\r\n")).toHaveLength(353);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });
});
