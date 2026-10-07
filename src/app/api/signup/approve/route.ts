import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ request_id: z.uuid() }).parse(await json(req));
    const { data: registration, error: readError } = await adminClient().from("driver_registration_requests")
      .select("has_driving_licence,trip_type,status").eq("id", body.request_id).single();
    if (readError || registration?.status !== "PENDING") throw new ApiError(409, "Registration is no longer pending");
    if (registration.has_driving_licence === null || !registration.trip_type)
      throw new ApiError(409, "Add the driving licence answer and type before approval");
    const { data, error } = await adminClient().rpc("approve_driver_registration_auto", {
      p_request_id: body.request_id,
      p_actor_id: who.id,
    });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json({ ok: true, driver_id: data });
  } catch (error) { return fail(error); }
}
