import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { inductionComplete, inductionConfirmation, INDUCTION_VERSION } from "./contractor-induction";
import { POST } from "../app/api/contractors/induction/route";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn() }));
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), actor: mocks.actor }));
vi.mock("./supabase", () => ({ adminClient: () => ({ rpc: mocks.rpc }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "signed-in-contractor" });
  mocks.rpc.mockResolvedValue({ data: { induction_version: INDUCTION_VERSION, induction_confirmed_at: "2026-11-02T04:00:00Z" }, error: null });
});
const request = (body: unknown) => new NextRequest("https://example.test/api/contractors/induction", { method: "POST", body: JSON.stringify(body) });
describe("self-declared contractor induction", () => {
  it("requires the current version and saved server timestamp", () => {
    expect(inductionComplete({})).toBe(false);
    expect(inductionComplete({ induction_version: INDUCTION_VERSION })).toBe(false);
    expect(inductionComplete({ induction_version: "old", induction_confirmed_at: "date" })).toBe(false);
    expect(inductionComplete({ induction_version: INDUCTION_VERSION, induction_confirmed_at: "date" })).toBe(true);
  });
  it("rejects missing, false or stale confirmations", async () => {
    for (const body of [{}, { confirmed: false, version: INDUCTION_VERSION }, { confirmed: "true", version: INDUCTION_VERSION }, { confirmed: true, version: "old" }]) {
      expect(inductionConfirmation.safeParse(body).success).toBe(false);
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the authenticated account, ignoring supplied identity and timestamps", async () => {
    const response = await POST(request({ confirmed: true, version: INDUCTION_VERSION, p_actor: "another-account", confirmed_at: "fake" }));
    expect(response.status).toBe(200);
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), ["contractor"]);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_contractor_induction", { p_actor: "signed-in-contractor" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
