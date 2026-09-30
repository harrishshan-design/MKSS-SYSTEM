import { afterEach, describe, expect, it, vi } from "vitest";
import { microsoftSetup, verifyWorkbookAccess } from "./excel";

const required = {
  MICROSOFT_CLIENT_ID: "client",
  MICROSOFT_CLIENT_SECRET: "secret",
  MICROSOFT_TENANT_ID: "tenant",
  MICROSOFT_DRIVE_ID: "drive",
  MICROSOFT_WORKBOOK_ID: "workbook",
  MICROSOFT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  APP_URL: "https://mkss.example.com",
};
function configured() { for (const [key, value] of Object.entries(required)) vi.stubEnv(key, value); }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Microsoft workbook connection", () => {
  it("lists missing configuration before offering sign-in", () => {
    for (const key of Object.keys(required)) vi.stubEnv(key, "");
    expect(microsoftSetup().ready).toBe(false);
    expect(microsoftSetup().missing).toContain("MICROSOFT_CLIENT_ID");
  });

  it("rejects a redirect origin different from the open app", () => {
    configured();
    expect(microsoftSetup("https://other.example.com").issues).toContain("APP_URL must match the address used to open MKSS SYSTEM");
  });

  it("only verifies a workbook when the file and worksheet APIs succeed", async () => {
    configured();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Operations.xlsx", webUrl: "https://example.sharepoint.com/workbook", file: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ name: "Sheet1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [[null]] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyWorkbookAccess("access-token")).resolves.toEqual({ name: "Operations.xlsx", webUrl: "https://example.sharepoint.com/workbook", worksheetCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/drives/drive/items/workbook/workbook/worksheets");
  });

  it("rejects a file that the signed-in Microsoft account cannot open as a workbook", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Operations.xlsx", file: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Access denied" } }), { status: 403 })));
    await expect(verifyWorkbookAccess("access-token")).rejects.toThrow("Graph 403: Access denied");
  });

  it("rejects a workbook when its range API is unavailable", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Operations.xlsx", file: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: "sheet-1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Not supported" } }), { status: 403 })));
    await expect(verifyWorkbookAccess("access-token")).rejects.toThrow("Graph 403: Not supported");
  });
});
