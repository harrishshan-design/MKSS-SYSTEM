import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fail, json } from "@/lib/api";
import { adminClient, publicClient } from "@/lib/supabase";
import { contractorIc } from "@/lib/contractors";

export async function POST(req: NextRequest) {
  try {
    const body = z.object({ vehicle: contractorIc, password: z.string().min(1).max(128) }).parse(await json(req));
    const db = adminClient();
    const { data: person, error: readError } = await db.from("contractors").select("auth_user_id").eq("identity_reference", body.vehicle).maybeSingle();
    if (readError) throw new ApiError(503, "Contractor sign-in is temporarily unavailable.");
    if (!person) throw new ApiError(401, "IC/passport number or password is incorrect.");
    const { data: user, error: userError } = await db.auth.admin.getUserById(person.auth_user_id);
    if (userError || !user.user?.email) throw new ApiError(401, "IC/passport number or password is incorrect.");
    const initialPassword = contractorIc.safeParse(body.password);
    const { data, error } = await publicClient().auth.signInWithPassword({ email: user.user.email,
      password: initialPassword.success ? initialPassword.data : body.password });
    if (error || !data.session) throw new ApiError(401, "IC/passport number or password is incorrect.");
    return NextResponse.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = fail(error); result.headers.set("Cache-Control", "no-store"); return result; }
}
