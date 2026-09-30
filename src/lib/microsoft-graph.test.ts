import { afterEach, describe, expect, it, vi } from "vitest";
import { listDestinations, microsoftSetup, resolveSharedWorkbook, shareToken, validateSpreadsheetLink, validateDestination } from "./microsoft-graph";

const workbook = { driveId: "drive-id", itemId: "item-id", name: "Operations.xlsx", webUrl: "https://example.sharepoint.com/workbook" };
const required = { MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret", MICROSOFT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), APP_URL: "https://mkss.example.com" };
function configured() { for (const [key, value] of Object.entries(required)) vi.stubEnv(key, value); }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Microsoft sharing-link connection", () => {
  it("requires only application settings, not tenant, drive or workbook IDs", () => {
    configured();
    expect(microsoftSetup("https://mkss.example.com").ready).toBe(true);
    expect(microsoftSetup("https://other.example.com").ready).toBe(false);
  });

  it("encodes a sharing URL for the Graph shares API and rejects unsafe links", () => {
    const url = "https://contoso.sharepoint.com/:x:/s/site/example?e=abc";
    expect(shareToken(url)).toBe(`u!${Buffer.from(url).toString("base64url")}`);
    expect(validateSpreadsheetLink(url)).toBe(url);
    expect(() => validateSpreadsheetLink("http://localhost/workbook.xlsx")).toThrow("HTTPS sharing link");
  });

  it("resolves the shared drive item and discovers worksheets and tables", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ id: "item-id", name: "Operations.xlsx", file: {}, webUrl: workbook.webUrl, parentReference: { driveId: "drive-id" } }))
      .mockResolvedValueOnce(response({ value: [{ id: "sheet-1", name: "Daily" }] }))
      .mockResolvedValueOnce(response({ value: [{ id: "table-1", name: "MKSS" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = await resolveSharedWorkbook("access-token", "https://contoso.sharepoint.com/shared");
    expect(resolved).toEqual(workbook);
    expect(await listDestinations("access-token", resolved)).toEqual([
      { kind: "worksheet", id: "sheet-1", name: "Daily" },
      { kind: "table", id: "table-1", name: "MKSS", worksheetId: "sheet-1", worksheetName: "Daily" },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("/shares/u!");
  });

  it("classifies an inaccessible shared link without storing a connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { message: "Item not found" } }, 404)));
    await expect(resolveSharedWorkbook("access-token", "https://contoso.sharepoint.com/missing")).rejects.toMatchObject({ code: "invalid_spreadsheet_link" });
  });

  it("reports permission denial separately from an invalid link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { message: "Access denied" } }, 403)));
    await expect(resolveSharedWorkbook("access-token", "https://contoso.sharepoint.com/restricted")).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("accepts an empty worksheet but protects worksheets with unrelated headers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ values: [[null]] })).mockResolvedValueOnce(response({ values: [["Other data"]] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(validateDestination("access-token", workbook, { kind: "worksheet", id: "sheet-1" })).resolves.toBeUndefined();
    await expect(validateDestination("access-token", workbook, { kind: "worksheet", id: "sheet-1" })).rejects.toThrow("empty worksheet");
    expect(fetchMock.mock.calls[0][0]).toContain("/range(address='A1:H1')");
  });

  it("requires the MKSS columns in a selected Excel table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ values: [["Other", "Columns"]] })));
    await expect(validateDestination("access-token", workbook, { kind: "table", id: "table-1" })).rejects.toThrow("This table needs these columns");
  });
});
