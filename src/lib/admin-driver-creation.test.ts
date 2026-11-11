import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/driver-accounts/create/route";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), create: vi.fn(), remove: vi.fn(), profile: vi.fn() }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), actor: mocks.actor }));
vi.mock("./supabase", () => ({ adminClient: () => ({ rpc: mocks.rpc, auth: { admin: { createUser: mocks.create, deleteUser: mocks.remove } }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }) }) }));
const valid = { action: "create", email: "driver@example.test", full_name: "Test Driver", phone: "0123456789", identity_reference: "012345678901", requested_company: "Test company", requested_lorry: "QA 1234", has_driving_licence: true, trip_type: "Manual" };
const request = (body: unknown) => new NextRequest("https://example.test/api/driver-accounts/create", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id: "admin" }); mocks.create.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.profile.mockResolvedValue({ data: null, error: null }); });
describe("admin driver creation", () => {
  it("requires admin access before account lookup or creation", async () => {
    mocks.actor.mockRejectedValue(new Error("Forbidden")); await POST(request(valid));
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), ["admin"]); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("flags duplicates before creating an auth account", async () => {
    mocks.rpc.mockResolvedValue({ data: ["Lorry already registered"], error: null });
    const response = await POST(request(valid)); expect(response.status).toBe(409); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("checks duplicates without creating and validates required registration details", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(request({ ...valid, action: "check" }))).status).toBe(200);
    expect((await POST(request({ ...valid, trip_type: "" }))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates a confirmed login with IC password and saves through atomic approval", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: "driver-id", error: null });
    const response = await POST(request(valid)); expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ email: valid.email, password: valid.identity_reference, email_confirm: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("admin_create_driver_account", { p_actor: "admin", p_user: "new-user", p_details: valid });
  });
  it("removes only its own unlinked login after a rejected registration", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "Concurrent duplicate" } });
    expect((await POST(request(valid))).status).toBe(409); expect(mocks.remove).toHaveBeenCalledWith("new-user");
  });
  it("preserves a committed account when the approval response was lost", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "Connection lost" } });
    mocks.profile.mockResolvedValue({ data: { id: "new-user" }, error: null });
    await POST(request(valid)); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
