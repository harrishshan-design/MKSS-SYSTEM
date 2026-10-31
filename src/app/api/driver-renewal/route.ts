import { after, NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverDetails } from "@/lib/driver-registration";
import { processApprovalPush, queueApprovalPush } from "@/lib/admin-push";
const details = driverDetails.omit({ email: true, identity_reference: true });
export async function GET(req: NextRequest) {
  try {
    const who = await actor(req, ["driver"]), db = adminClient();
    const [person, vehicle, request] = await Promise.all([
      db.from("drivers").select("full_name,phone,has_driving_licence,default_trip_type,registration_status,registration_version,companies(name)").eq("id", who.driver_id).single(),
      db.from("lorries").select("registration_number").eq("assigned_driver_id", who.driver_id).order("created_at").limit(1),
      db.from("driver_registration_requests").select("status,renewal_driver_id").eq("auth_user_id", who.id).maybeSingle(),
    ]);
    if (person.error || vehicle.error || request.error) throw person.error || vehicle.error || request.error;
    return NextResponse.json({ person: person.data, vehicle: vehicle.data?.[0]?.registration_number || "", pending: request.data?.status === "PENDING" && Boolean(request.data.renewal_driver_id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["driver"]), body = details.parse(await json(req));
    const result = await adminClient().rpc("request_driver_renewal", { p_actor: who.id, p_details: body });
    if (result.error) throw new ApiError(409, result.error.message);
    try { await queueApprovalPush(result.data); } catch (error) { console.error("Renewal notification queue failed", error); }
    after(async () => { try { await processApprovalPush(); } catch (error) { console.error("Renewal notification delivery failed", error); } });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) { return fail(error); }
}
