import { NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverPassCode } from "@/lib/rotating-qr";
export async function GET(req: NextRequest) {
  try { const who=await actor(req,["driver"]); if(!who.driver_id) throw new ApiError(403,"Driver profile missing"); const db=adminClient();
    const [{data:driver,error:driverError},{data:visits,error:visitError}]=await Promise.all([
      db.from("drivers").select("id,full_name,qr_token,qr_active,active,phone,default_trip_type,companies(name),lorries(id,registration_number,vehicle_type,active)").eq("id",who.driver_id).single(),
      db.from("visits").select("id,visit_code,status,security_registered_at,company_time_in,company_time_out,loading_area_in,loading_area_out,last_location_at,exit_pending_at").eq("driver_id",who.driver_id).order("created_at",{ascending:false}).limit(20)
    ]); if(driverError||visitError) throw driverError||visitError;
    if (!driver) throw new ApiError(404, "Driver profile missing");
    const { qr_token, ...safeDriver } = driver;
    return NextResponse.json({driver:{...safeDriver,pass_code:driver.qr_active?driverPassCode(driver.id,qr_token):null},visits});
  } catch(error) { return fail(error); }
}
