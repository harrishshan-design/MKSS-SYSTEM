import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverDetails } from "@/lib/driver-registration";

const fields = "id,auth_user_id,email,full_name,phone,identity_reference,requested_company,has_driving_licence,trip_type,requested_lorry,requested_vehicle_type,status,created_at";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const { data, error } = await adminClient().from("driver_registration_requests")
      .select(fields)
      .eq("status", "PENDING").order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return fail(error); }
}

export async function PATCH(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = driverDetails.extend({ id: z.uuid() }).parse(await json(req));
    const db = adminClient();
    const { data: previous, error: readError } = await db.from("driver_registration_requests")
      .select(fields).eq("id", body.id).eq("status", "PENDING").single();
    if (readError || !previous) throw new ApiError(409, "This registration is no longer pending");
    const changedEmail = body.email !== previous.email;
    if (changedEmail) {
      const { error } = await db.auth.admin.updateUserById(previous.auth_user_id, { email: body.email, email_confirm: true });
      if (error) throw new ApiError(409, error.message);
    }
    const { data: updated, error: updateError } = await db.from("driver_registration_requests").update({
      email: body.email, full_name: body.full_name, phone: body.phone,
      identity_reference: body.identity_reference, requested_company: body.requested_company,
      has_driving_licence: body.has_driving_licence, trip_type: body.trip_type,
    }).eq("id", body.id).eq("status", "PENDING").select(fields).maybeSingle();
    if (updateError || !updated) {
      if (changedEmail) {
        const { error: rollbackError } = await db.auth.admin.updateUserById(previous.auth_user_id, { email: previous.email, email_confirm: true });
        if (rollbackError) console.error("Registration email rollback failed", rollbackError);
      }
      throw new ApiError(409, updateError?.message || "This registration was reviewed while you were editing");
    }
    await audit(who, "DRIVER_REGISTRATION_EDITED", "driver_registration_requests", body.id,
      { email: previous.email, full_name: previous.full_name, phone: previous.phone, identity_reference: previous.identity_reference, requested_company: previous.requested_company, has_driving_licence: previous.has_driving_licence, trip_type: previous.trip_type },
      { email: updated.email, full_name: updated.full_name, phone: updated.phone, identity_reference: updated.identity_reference, requested_company: updated.requested_company, has_driving_licence: updated.has_driving_licence, trip_type: updated.trip_type });
    return NextResponse.json(updated);
  } catch (error) { return fail(error); }
}
