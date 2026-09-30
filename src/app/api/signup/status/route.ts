import { NextRequest, NextResponse } from "next/server";
import { ApiError, fail } from "@/lib/api";
import { adminClient, publicClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!token) throw new ApiError(401, "Sign in required");
    const { data, error } = await publicClient().auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, "Session expired. Sign in again.");
    const { data: request, error: requestError } = await adminClient().from("driver_registration_requests")
      .select("status,full_name,requested_company,requested_lorry,created_at")
      .eq("auth_user_id", data.user.id).maybeSingle();
    if (requestError) throw requestError;
    if (!request) throw new ApiError(404, "No registration request found for this account");
    return NextResponse.json(request);
  } catch (error) { return fail(error); }
}
