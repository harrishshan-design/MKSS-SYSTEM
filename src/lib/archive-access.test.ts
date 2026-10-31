import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "./api";
import { GET, POST } from "../app/api/archives/route";
import { GET as download } from "../app/api/archives/download/route";
import { GET as history } from "../app/api/driver-history/route";
const security = vi.hoisted(() => ({ actor: vi.fn(), admin: vi.fn() }));
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), actor: security.actor }));
vi.mock("./supabase", () => ({ adminClient: security.admin, publicClient: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); security.actor.mockRejectedValue(new ApiError(403, "Insufficient permission")); });
describe("admin-only storage and registration history", () => {
  it("blocks non-admin reads, downloads and cleanup before accessing any data", async () => {
    const req = new NextRequest("https://example.test/api/archives");
    for (const response of [await GET(req), await POST(new NextRequest(req.url, { method: "POST", body: JSON.stringify({ action: "confirm", saved: true }) })), await download(req), await history(req)])
      expect(response.status).toBe(403);
    expect(security.admin).not.toHaveBeenCalled();
    for (const call of security.actor.mock.calls) expect(call[1]).toEqual(["admin"]);
  });
  it("requires explicit saved-file confirmation even for an administrator", async () => {
    security.actor.mockResolvedValue({ id: "admin", role: "admin" });
    for (const body of [{ action: "confirm", saved: false }, { action: "remove_online", saved_copies: false }]) {
      const response = await POST(new NextRequest("https://example.test/api/archives", { method: "POST", body: JSON.stringify({ ...body, batch_id: "00000000-0000-4000-8000-000000000001" }) }));
      expect(response.status).toBe(400);
    }
    expect(security.admin).not.toHaveBeenCalled();
  });
});
