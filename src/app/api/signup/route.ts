import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

const signup = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  licence_number: z.string().trim().max(80).optional(),
  requested_company: z.string().trim().min(2).max(120),
  requested_lorry: z.string().trim().min(2).max(40),
});

export async function POST(req: NextRequest) {
  try {
    const body = signup.parse(await json(req));
    const db = adminClient();
    const { error: schemaError } = await db.from("driver_registration_requests").select("id").limit(0);
    if (schemaError) throw new ApiError(503, "Driver sign-up is not ready. Ask the administrator to apply the database migrations.");

    const { data, error } = await db.auth.admin.createUser({
      email: body.email.toLowerCase(),
      password: body.password,
      email_confirm: true,
    });
    if (error) {
      if (error.code === "email_exists" || /already.*registered|already.*exists|email.*exists/i.test(error.message)) return NextResponse.json({ ok: true }, { status: 202 });
      throw new ApiError(400, error.message);
    }
    if (!data.user) throw new ApiError(502, "Could not create the account. Please try again.");

    const { error: insertError } = await db.from("driver_registration_requests").insert({
      auth_user_id: data.user.id,
      email: body.email.toLowerCase(),
      full_name: body.full_name,
      phone: body.phone,
      licence_number: body.licence_number || null,
      requested_company: body.requested_company,
      requested_lorry: body.requested_lorry.toUpperCase(),
    });
    if (insertError) {
      await db.auth.admin.deleteUser(data.user.id);
      throw insertError;
    }
    return NextResponse.json({ ok: true, email_confirmation_required: false }, { status: 202 });
  } catch (error) { return fail(error); }
}
