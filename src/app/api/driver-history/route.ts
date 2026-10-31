import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]); const id = z.uuid().parse(req.nextUrl.searchParams.get("driver_id")), db = adminClient();
    const [driver, history] = await Promise.all([
      db.from("drivers").select("id,driver_code,registered_at,last_active_at,inactive_at,registration_status,registration_version").eq("id", id).single(),
      db.from("driver_registration_history").select("registration_version,registered_at,expired_at,status,details").eq("driver_id", id).order("registration_version", { ascending: false }),
    ]);
    if (driver.error || history.error) throw driver.error || history.error;
    return NextResponse.json({ driver: driver.data, history: history.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
