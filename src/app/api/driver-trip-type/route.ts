import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { tripDeadline } from "@/lib/trip-type";

const correction = z.object({
  driver_id: z.uuid(),
  trip_type: z.enum(["Hantar Barang", "Ambil Barang", "Manual"]),
});

type OpenVisit = {
  id: string;
  purpose: string | null;
  company_time_in: string | null;
  auto_timeout_at: string | null;
  registration_source: string | null;
};

export async function PATCH(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = correction.parse(await json(req));
    const db = adminClient();
    const { data: driver, error: driverError } = await db.from("drivers")
      .select("id,full_name,default_trip_type").eq("id", body.driver_id).single();
    if (driverError || !driver) throw new ApiError(404, "Driver not found");
    if (driver.default_trip_type === body.trip_type) return NextResponse.json({ ok: true, updated_open_trips: 0 });

    const { data: account, error: accountError } = await db.from("users")
      .select("id").eq("driver_id", driver.id).eq("role", "driver").maybeSingle();
    if (accountError) throw accountError;
    const [{ data: registrations, error: requestError }, { data: visits, error: visitError }] = await Promise.all([
      account ? db.from("driver_registration_requests").select("id,trip_type")
        .eq("auth_user_id", account.id).eq("status", "APPROVED") : Promise.resolve({ data: [], error: null }),
      db.from("visits").select("id,purpose,company_time_in,auto_timeout_at,registration_source")
        .eq("driver_id", driver.id).is("company_time_out", null)
        .not("status", "in", "(COMPLETED,CANCELLED)"),
    ]);
    if (requestError || visitError) throw requestError || visitError;

    const correctedVisits: OpenVisit[] = [];
    const correctedRequests: { id: string; trip_type: string | null }[] = [];
    let driverChanged = false;
    try {
      let driverUpdate = db.from("drivers")
        .update({ default_trip_type: body.trip_type }).eq("id", driver.id);
      driverUpdate = driver.default_trip_type === null
        ? driverUpdate.is("default_trip_type", null)
        : driverUpdate.eq("default_trip_type", driver.default_trip_type);
      const { data: changedDriver, error: updateError } = await driverUpdate.select("id").maybeSingle();
      if (updateError || !changedDriver) throw updateError || new ApiError(409, "Driver type changed while you were editing. Refresh and try again.");
      driverChanged = true;

      for (const registration of registrations || []) {
        const { data, error } = await db.from("driver_registration_requests")
          .update({ trip_type: body.trip_type }).eq("id", registration.id)
          .eq("status", "APPROVED").select("id").maybeSingle();
        if (error || !data) throw error || new Error("Approved registration changed during correction");
        correctedRequests.push(registration);
      }

      for (const visit of (visits || []) as OpenVisit[]) {
        if (visit.registration_source !== "DRIVER_DAILY_QR" ||
            (visit.purpose !== driver.default_trip_type && visit.purpose !== null)) continue;
        const { data, error } = await db.from("visits").update({
          purpose: body.trip_type,
          auto_timeout_at: tripDeadline(visit.company_time_in, body.trip_type),
        }).eq("id", visit.id).is("company_time_out", null)
          .not("status", "in", "(COMPLETED,CANCELLED)").select("id").maybeSingle();
        if (error) throw error;
        if (data) correctedVisits.push(visit);
      }

      await audit(who, "DRIVER_TRIP_TYPE_CORRECTED", "drivers", driver.id,
        { trip_type: driver.default_trip_type },
        { trip_type: body.trip_type, updated_open_trips: correctedVisits.length },
        "Administrator corrected an approved driver's trip type");
    } catch (error) {
      for (const visit of correctedVisits) {
        const { error: rollbackError } = await db.from("visits").update({
          purpose: visit.purpose, auto_timeout_at: visit.auto_timeout_at,
        }).eq("id", visit.id).is("company_time_out", null);
        if (rollbackError) console.error("Visit type rollback failed", rollbackError);
      }
      for (const registration of correctedRequests) {
        const { error: rollbackError } = await db.from("driver_registration_requests")
          .update({ trip_type: registration.trip_type }).eq("id", registration.id);
        if (rollbackError) console.error("Registration type rollback failed", rollbackError);
      }
      if (driverChanged) {
        const { error: rollbackError } = await db.from("drivers")
          .update({ default_trip_type: driver.default_trip_type }).eq("id", driver.id)
          .eq("default_trip_type", body.trip_type);
        if (rollbackError) console.error("Driver type rollback failed", rollbackError);
      }
      throw error;
    }

    return NextResponse.json({ ok: true, updated_open_trips: correctedVisits.length });
  } catch (error) { return fail(error); }
}
