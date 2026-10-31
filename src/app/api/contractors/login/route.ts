import { NextRequest, NextResponse } from "next/server";
import { ApiError, fail, json } from "@/lib/api";
import { adminClient, publicClient } from "@/lib/supabase";
import { contractorLogin, normalizeContractorName } from "@/lib/contractors";

export async function POST(req: NextRequest) {
  try {
    const body = contractorLogin.parse(await json(req));
    const db = adminClient();
    const { data: person, error: readError } = await db.from("contractors").select("auth_user_id,full_name").eq("identity_reference", body.password).maybeSingle();
    if (readError) throw new ApiError(503, "Contractor sign-in is temporarily unavailable.");
    if (!person || normalizeContractorName(person.full_name) !== normalizeContractorName(body.name))
      throw new ApiError(401, "Name or IC/passport number is incorrect.");
    const { data: user, error: userError } = await db.auth.admin.getUserById(person.auth_user_id);
    if (userError || !user.user?.email) throw new ApiError(401, "Name or IC/passport number is incorrect.");
    const { data, error } = await publicClient().auth.signInWithPassword({ email: user.user.email,
      password: body.password });
    if (error || !data.session) throw new ApiError(401, "Name or IC/passport number is incorrect.");
    return NextResponse.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { const result = fail(error); result.headers.set("Cache-Control", "no-store"); return result; }
}
