import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverDetails } from "@/lib/driver-registration";

const lookup = driverDetails.pick({ email: true, requested_lorry: true, identity_reference: true });
const schema = z.discriminatedUnion("action", [lookup.extend({ action: z.literal("check") }), driverDetails.extend({ action: z.literal("create"), identity_reference: z.string().trim().min(12).max(30) })]);
export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]), body = schema.parse(await json(req)), db = adminClient();
    const checked = await db.rpc("driver_account_conflicts", { p_actor: who.id, p_email: body.email, p_vehicle: body.requested_lorry, p_identity: body.identity_reference });
    if (checked.error) throw checked.error;
    const conflicts = checked.data as string[];
    if (body.action === "check") return NextResponse.json({ conflicts });
    if (conflicts.length) throw new ApiError(409, conflicts.join(" "));
    const { data, error } = await db.auth.admin.createUser({ email: body.email, password: body.identity_reference, email_confirm: true });
    if (error || !data.user) throw new ApiError(409, error?.code === "email_exists" ? "Email already registered. Use the existing account." : error?.message || "Could not create login");
    const created = await db.rpc("admin_create_driver_account", { p_actor: who.id, p_user: data.user.id, p_details: body });
    if (created.error) {
      // Do not remove an account if a lost RPC response may have committed approval.
      const profile = await db.from("users").select("id").eq("id", data.user.id).maybeSingle();
      if (!profile.error && !profile.data) {
        const removed = await db.auth.admin.deleteUser(data.user.id);
        if (removed.error) throw new ApiError(503, "Creation needs review. A login may exist; check User accounts before retrying.");
      }
      throw new ApiError(409, created.error.message);
    }
    return NextResponse.json({ ok: true, driver_id: created.data, email: body.email }, { status: 201 });
  } catch (error) { return fail(error); }
}
