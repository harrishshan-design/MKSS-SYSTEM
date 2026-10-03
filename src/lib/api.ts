import { NextRequest, NextResponse } from "next/server";
import { adminClient, publicClient } from "@/lib/supabase";
import type { Actor, Role } from "@/lib/types";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function fail(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (status === 500) console.error(error);
  return NextResponse.json({ error: message }, { status });
}
export async function actor(req: NextRequest, allowed?: Role[]): Promise<Actor> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new ApiError(401, "Sign in required");
  const { data, error } = await publicClient().auth.getUser(token);
  if (error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500)) throw new ApiError(503, "Sign-in service is temporarily unavailable. Please retry.");
  if (error || !data.user) throw new ApiError(401, "Session expired. Sign in again.");
  const { data: profile, error: profileError } = await adminClient().from("users").select("id,role,name,driver_id,guard_id,active").eq("id", data.user.id).single();
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
