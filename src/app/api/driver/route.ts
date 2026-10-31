import { NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverPassCode } from "@/lib/rotating-qr";
import { siteDate } from "@/lib/date";
export async function GET(req: NextRequest) {
  try { const who=await actor(req,["driver"]); if(!who.driver_id) throw new ApiError(403,"Driver profile missing"); const db=adminClient();
    const expired=await db.rpc("expire_idle_drivers",{p_driver:who.driver_id}); if(expired.error)throw expired.error;
    const today=siteDate();
    const [{data:driver,error:driverError},{data:visits,error:visitError},{count:todayTripCount,error:countError},{count:todayCheckoutCount,error:checkoutError}]=await Promise.all([
      db.from("drivers").select("id,full_name,qr_token,qr_active,active,phone,registration_status,registration_version,last_active_at,inactive_at,default_trip_type,companies(name),lorries(id,registration_number,vehicle_type,active)").eq("id",who.driver_id).single(),
      db.from("visits").select("id,visit_code,visit_date,status,security_registered_at,company_time_in,company_time_out,loading_area_in,loading_area_out,last_location_at,exit_pending_at,auto_timeout_at,checkout_method,exit_verified_at,purpose").eq("driver_id",who.driver_id).order("security_registered_at",{ascending:false}).limit(100),
      db.from("visits").select("id",{count:"exact",head:true}).eq("driver_id",who.driver_id).eq("visit_date",today).not("company_time_in","is",null),
      db.from("visits").select("id",{count:"exact",head:true}).eq("driver_id",who.driver_id).eq("visit_date",today)
        .not("company_time_out","is",null).or("checkout_method.is.null,checkout_method.neq.TIME_LIMIT")
    ]); if(driverError||visitError||countError||checkoutError) throw driverError||visitError||countError||checkoutError;
    if (!driver) throw new ApiError(404, "Driver profile missing");
    const { qr_token, ...safeDriver } = driver;
    return NextResponse.json({driver:{...safeDriver,pass_code:driver.qr_active?driverPassCode(driver.id,qr_token):null},visits,todayTripCount:todayTripCount||0,todayCheckoutCount:todayCheckoutCount||0});
  } catch(error) { return fail(error); }
}
