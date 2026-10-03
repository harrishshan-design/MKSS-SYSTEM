import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const db = adminClient();
    const { data: profiles, error } = await db.from("users")
      .select("id,name,active,driver_id,drivers(full_name,phone,licence_number,companies(name),lorries(registration_number,vehicle_type))")
      .eq("role", "driver").order("name");
    if (error) throw error;
    const accounts = await Promise.all((profiles || []).map(async profile => {
      const { data, error: authError } = await db.auth.admin.getUserById(profile.id);
      if (authError) throw authError;
      return { ...profile, email: data.user.email || "" };
    }));
    return NextResponse.json(accounts);
  } catch (error) { return fail(error); }
}

const change = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), user_id: z.uuid(), email: z.email().max(254).transform(value => value.trim().toLowerCase()) }),
  z.object({ kind: z.literal("password"), user_id: z.uuid(), new_password: z.string().min(12).max(128) }),
]);

export async function PATCH(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = change.parse(await json(req));
    const db = adminClient();
    const { data: profile, error: profileError } = await db.from("users")
      .select("id,role,name,active").eq("id", body.user_id).single();
    if (profileError || !profile || profile.role !== "driver") throw new ApiError(404, "Driver account not found");
    const { data: existing, error: readError } = await db.auth.admin.getUserById(body.user_id);
    if (readError || !existing.user) throw new ApiError(404, "Driver login not found");

    if (body.kind === "email") {
      const oldEmail = existing.user.email || "";
      if (body.email === oldEmail.toLowerCase()) return NextResponse.json({ ok: true, email: oldEmail });
      const { error: authError } = await db.auth.admin.updateUserById(body.user_id,
        { email: body.email, email_confirm: true });
      if (authError) throw new ApiError(409, authError.message);
      const { error: requestError } = await db.from("driver_registration_requests")
        .update({ email: body.email }).eq("auth_user_id", body.user_id);
      if (requestError) {
        const { error: rollbackError } = await db.auth.admin.updateUserById(body.user_id,
          { email: oldEmail, email_confirm: true });
        if (rollbackError) console.error("Driver email rollback failed", rollbackError);
        throw requestError;
      }
      try { await audit(who, "DRIVER_EMAIL_UPDATED", "users", body.user_id,
        { email: oldEmail }, { email: body.email }); }
      catch (auditError) { console.error("Driver email audit failed", auditError); }
      return NextResponse.json({ ok: true, email: body.email });
    }

    const { error: passwordError } = await db.auth.admin.updateUserById(body.user_id,
      { password: body.new_password });
    if (passwordError) throw new ApiError(409, passwordError.message);
    try { await audit(who, "DRIVER_PASSWORD_RESET", "users", body.user_id); }
    catch (auditError) { console.error("Driver password audit failed", auditError); }
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
