import { after, NextRequest, NextResponse } from "next/server";
import { ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { signup, vehicleLoginKey } from "@/lib/driver-registration";
import { processApprovalPush, queueApprovalPush } from "@/lib/admin-push";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = signup.parse(await json(req));
    const db = adminClient();
    const { error: schemaError } = await db.from("driver_registration_requests").select("id,has_driving_licence,trip_type").limit(0);
    if (schemaError) throw new ApiError(503, "Driver sign-up is not ready. Ask the administrator to apply the database migrations.");

    const { data: matches, error: lookupError } = await db.rpc("driver_vehicle_login_candidates", { p_vehicle: vehicleLoginKey(body.requested_lorry) });
    if (lookupError) throw new ApiError(503, "Driver sign-up is not ready. Ask the administrator to apply the database migrations.");
    if (matches?.length) throw new ApiError(409, "This vehicle already has a driver account or pending request. Ask the administrator to review it.");

    const { data, error } = await db.auth.admin.createUser({
      email: body.email,
      password: body.identity_reference,
      email_confirm: true,
    });
    if (error) {
      if (error.code === "email_exists" || /already.*registered|already.*exists|email.*exists/i.test(error.message)) return NextResponse.json({ ok: true }, { status: 202 });
      throw new ApiError(400, error.message);
    }
    if (!data.user) throw new ApiError(502, "Could not create the account. Please try again.");

    const { data: request, error: insertError } = await db.from("driver_registration_requests").insert({
      auth_user_id: data.user.id,
      email: body.email,
      full_name: body.full_name,
      phone: body.phone,
      identity_reference: body.identity_reference,
      requested_company: body.requested_company,
      requested_lorry: body.requested_lorry,
      has_driving_licence: body.has_driving_licence,
      trip_type: body.trip_type,
    }).select("id").single();
    if (insertError || !request) {
      await db.auth.admin.deleteUser(data.user.id);
      throw insertError || new Error("Could not save driver registration");
    }
    try { await queueApprovalPush(request.id); }
    catch (pushError) { console.error("Could not queue admin phone alerts", pushError); }
    after(async () => {
      try { await processApprovalPush(); }
      catch (pushError) { console.error("Could not deliver admin phone alerts", pushError); }
    });
    return NextResponse.json({ ok: true, email_confirmation_required: false }, { status: 202 });
  } catch (error) { return fail(error); }
}
