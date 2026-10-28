import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { contractorSignup } from "@/lib/contractors";

export async function POST(req: NextRequest) {
  try {
    const body = contractorSignup.parse(await json(req));
    const db = adminClient();
    const { data: existing, error: lookupError } = await db.from("contractors").select("id")
      .eq("identity_reference", body.identity_reference).maybeSingle();
    if (lookupError) throw new ApiError(503, "Contractor registration is temporarily unavailable.");
    if (existing) return NextResponse.json({ ok: true }, { status: 202 });
    const { data, error } = await db.auth.admin.createUser({
      email: `contractor-${randomUUID()}@contractors.mkss.invalid`, password: body.identity_reference, email_confirm: true,
    });
    if (error || !data.user) throw new ApiError(400, "Could not create contractor sign-in. Please retry.");
    const { error: registrationError } = await db.rpc("register_contractor", {
      p_user: data.user.id, p_name: body.full_name, p_ic: body.identity_reference,
      p_company: body.company_name, p_work: body.work_type,
    });
    if (registrationError) {
      await db.auth.admin.deleteUser(data.user.id);
      if (registrationError.code !== "23505") throw new ApiError(503, "Could not save contractor registration. Please retry.");
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) { return fail(error); }
}
