import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/contractors/login/route";

const db = vi.hoisted(() => ({ lookup: vi.fn(), getUser: vi.fn(), signIn: vi.fn() }));
vi.mock("./supabase", () => ({
  adminClient: () => ({
    from: () => ({ select: () => ({ eq: db.lookup }) }),
    auth: { admin: { getUserById: db.getUser } },
  }),
  publicClient: () => ({ auth: { signInWithPassword: db.signIn } }),
}));
const request = (name: string, password: string) => new NextRequest("https://example.test/api/contractors/login", {
  method: "POST", body: JSON.stringify({ name, password }), headers: { "Content-Type": "application/json" },
});
beforeEach(() => {
  vi.clearAllMocks();
  db.lookup.mockImplementation((_column, identity) => ({ maybeSingle: async () => ({
    data: ["123456", "654321"].includes(identity) ? { auth_user_id: `user-${identity}`, full_name: "Same Name" } : null,
    error: null,
  }) }));
  db.getUser.mockImplementation(async id => ({ data: { user: { email: `${id}@contractors.mkss.invalid` } }, error: null }));
  db.signIn.mockResolvedValue({ data: { session: { access_token: "access", refresh_token: "refresh" } }, error: null });
});

describe("contractor name and identity-password login", () => {
  it("selects contractors with the same name by their unique identity number", async () => {
    for (const password of ["123456", "654321"]) {
      const response = await POST(request("  SAME   name  ", password));
      expect(response.status).toBe(200);
      expect(db.lookup).toHaveBeenLastCalledWith("identity_reference", password);
      expect(db.signIn).toHaveBeenLastCalledWith({ email: `user-${password}@contractors.mkss.invalid`, password });
      expect(await response.json()).toEqual({ access_token: "access", refresh_token: "refresh" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("rejects mismatched names and unknown identities with the same error", async () => {
    const mismatch = await POST(request("Another Person", "123456"));
    const missing = await POST(request("Same Name", "999999"));
    expect(mismatch.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await mismatch.json()).toEqual(await missing.json());
    expect(db.getUser).not.toHaveBeenCalled();
    expect(db.signIn).not.toHaveBeenCalled();
  });
  it("still requires Supabase password authentication and normalizes formatted IC numbers", async () => {
    db.lookup.mockReturnValue({ maybeSingle: async () => ({ data: { auth_user_id: "ic-user", full_name: "Same Name" }, error: null }) });
    db.signIn.mockResolvedValue({ data: { session: null }, error: { message: "Invalid credentials" } });
    const response = await POST(request("Same Name", "900101-10-1234"));
    expect(db.lookup).toHaveBeenCalledWith("identity_reference", "900101101234");
    expect(db.signIn).toHaveBeenCalledWith({ email: "ic-user@contractors.mkss.invalid", password: "900101101234" });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
