import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverIdFromPass, verifyDriverPassCode } from "@/lib/rotating-qr";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["guard"]);
    const { token } = z.object({ token: z.string().max(160) }).parse(await json(req));
    const driverId = driverIdFromPass(token);
    if (!driverId) throw new ApiError(409, "Driver QR is invalid or expired. Scan it again.");
    const db = adminClient();
    const { data: driver, error: driverError } = await db.from("drivers")
      .select("id,qr_token,qr_active,active").eq("id", driverId).single();
    if (driverError || !driver?.active || !driver.qr_active || !verifyDriverPassCode(token, driver.id, driver.qr_token))
      throw new ApiError(409, "Driver QR is invalid or expired. Scan it again.");
    const { data: visit, error } = await db.rpc("confirm_guard_exit", { p_actor_id: who.id, p_driver_id: driverId });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json({ visit });
  } catch (error) { return fail(error); }
}
