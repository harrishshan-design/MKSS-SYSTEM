import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { adminClient, publicClient } from "./supabase";
import type { Actor, Role } from "./types";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
// Dedicated verifier: reuse the SDK's signing-key cache without sharing a
// sign-in client's mutable session across server requests.
let tokenVerifier: ReturnType<typeof publicClient> | undefined;
export function fail(error: unknown) {
  const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
  const firstIssue = error instanceof ZodError ? error.issues[0] : null;
  const field = firstIssue?.path.join(".");
  const label = field === "requested_lorry" ? "vehicle number" : field?.replaceAll("_", " ");
  const message = error instanceof ZodError
    ? `${label ? `${label}: ` : ""}${firstIssue?.code === "invalid_type" ? "required" : firstIssue?.message || "Invalid input"}`
    : error instanceof Error ? error.message : "Unexpected error";
  if (status === 500) console.error(error);
  return NextResponse.json({ error: message }, { status });
}
export async function actor(req: NextRequest, allowed?: Role[]): Promise<Actor> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new ApiError(401, "Sign in required");
  tokenVerifier ??= publicClient();
  const { data, error } = await tokenVerifier.auth.getClaims(token);
  if (error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500)) throw new ApiError(503, "Sign-in service is temporarily unavailable. Please retry.");
  if (error || !data?.claims.sub || data.claims.role !== "authenticated") throw new ApiError(401, "Session expired. Sign in again.");
  // Always read current access: role changes and deactivation apply immediately.
  const { data: profile, error: profileError } = await adminClient().from("users").select("id,role,name,driver_id,guard_id,contractor_id,active").eq("id", data.claims.sub).single();
  if (profileError && profileError.code !== "PGRST116") throw new ApiError(503, "Database is temporarily unavailable. Please retry.");
  if (!profile?.active) throw new ApiError(403, "Account is inactive or has no assigned role");
  if (allowed && !allowed.includes(profile.role)) throw new ApiError(403, "Insufficient permission");
  return profile as Actor;
}
export async function json(req: NextRequest) {
  try { return await req.json() as Record<string, unknown>; }
  catch { throw new ApiError(400, "Invalid JSON body"); }
}
export async function audit(by: Actor, action: string, entityType: string, entityId: string, oldValue?: unknown, newValue?: unknown, reason?: string) {
  const { error } = await adminClient().from("audit_logs").insert({ actor_id: by.id, action, entity_type: entityType, entity_id: entityId, old_value: oldValue ?? null, new_value: newValue ?? null, reason: reason ?? null });
  if (error) throw error;
}
