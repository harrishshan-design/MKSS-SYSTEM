import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { actor } from "./api";

const db = vi.hoisted(() => ({ claims: vi.fn(), profile: vi.fn(), from: vi.fn() }));
vi.mock("./supabase", () => ({
  publicClient: () => ({ auth: { getClaims: db.claims } }),
  adminClient: () => ({ from: db.from }),
}));

const request = () => new NextRequest("https://example.test/api/overview", { headers: { authorization: "Bearer test-token" } });
beforeEach(() => {
  vi.clearAllMocks();
  db.claims.mockResolvedValue({ data: { claims: { sub: "staff-id", role: "authenticated" } }, error: null });
  db.from.mockReturnValue({ select: () => ({ eq: () => ({ single: db.profile }) }) });
  db.profile.mockResolvedValue({ data: { id: "staff-id", role: "admin", name: "Staff", active: true }, error: null });
});

describe("request authorization with verified claims", () => {
  it("verifies the supplied token and checks the active database profile", async () => {
    expect((await actor(request(), ["admin"])).role).toBe("admin");
    expect(db.claims).toHaveBeenCalledWith("test-token");
    expect(db.profile).toHaveBeenCalledOnce();
  });
  it("rejects unverified and non-user claims before querying profiles", async () => {
    db.claims.mockResolvedValueOnce({ data: null, error: { status: 401 } });
    await expect(actor(request())).rejects.toMatchObject({ status: 401 });
    db.claims.mockResolvedValueOnce({ data: { claims: { sub: "staff-id", role: "service_role" } }, error: null });
    await expect(actor(request())).rejects.toMatchObject({ status: 401 });
    expect(db.profile).not.toHaveBeenCalled();
  });
  it("does not cache permissions after role changes or deactivation", async () => {
    await actor(request(), ["admin"]);
    db.profile.mockResolvedValueOnce({ data: { id: "staff-id", role: "monitor", active: true }, error: null });
    await expect(actor(request(), ["admin"])).rejects.toMatchObject({ status: 403 });
    db.profile.mockResolvedValueOnce({ data: { id: "staff-id", role: "admin", active: false }, error: null });
    await expect(actor(request(), ["admin"])).rejects.toMatchObject({ status: 403 });
    expect(db.profile).toHaveBeenCalledTimes(3);
  });
  it("keeps Auth outages separate from expired credentials", async () => {
    db.claims.mockResolvedValueOnce({ data: null, error: { name: "AuthRetryableFetchError", status: 503 } });
    await expect(actor(request())).rejects.toMatchObject({ status: 503 });
    expect(db.profile).not.toHaveBeenCalled();
  });
});
