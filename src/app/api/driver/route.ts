import { NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req: NextRequest) {
  try { const who=await actor(req,["driver"]); if(!who.driver_id) throw new ApiError(403,"Driver profile missing"); const db=adminClient();
    const [{data:driver,error:driverError},{data:visits,error:visitError}]=await Promise.all([
      db.from("drivers").select("id,full_name,qr_token,qr_active,active,phone,companies(name),lorries(id,registration_number,vehicle_type,active)").eq("id",who.driver_id).single(),
      db.from("visits").select("id,visit_code,status,security_registered_at,company_time_in,company_time_out,loading_area_in,loading_area_out").eq("driver_id",who.driver_id).order("created_at",{ascending:false}).limit(20)
    ]); if(driverError||visitError) throw driverError||visitError; return NextResponse.json({driver,visits});
  } catch(error) { return fail(error); }
}
