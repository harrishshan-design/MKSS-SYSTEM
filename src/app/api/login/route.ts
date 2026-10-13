import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fail, json } from "@/lib/api";
import { vehicleLoginKey } from "@/lib/driver-registration";
import { adminClient, publicClient } from "@/lib/supabase";

const credentials = z.object({
  vehicle: z.string().trim().min(2).max(40),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const { vehicle, password } = credentials.parse(await json(req));
    const key = vehicleLoginKey(vehicle);
    if (key.length < 2) throw new ApiError(401, "Vehicle number or password is incorrect.");
    const db = adminClient();
    const { data: matches, error: lookupError } = await db.rpc("driver_vehicle_login_candidates", { p_vehicle: key });
    if (lookupError) throw new ApiError(503, "Sign-in is temporarily unavailable. Please retry.");
    if (matches?.length !== 1) throw new ApiError(401, "Vehicle number or password is incorrect. Ask the administrator if this vehicle is shared.");
    const { data: user, error: userError } = await db.auth.admin.getUserById(matches[0].auth_user_id);
    if (userError || !user.user?.email) throw new ApiError(401, "Vehicle number or password is incorrect.");
    const { data, error } = await publicClient().auth.signInWithPassword({ email: user.user.email, password });
    if (error || !data.session) throw new ApiError(401, "Vehicle number or password is incorrect.");
    return NextResponse.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = fail(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
