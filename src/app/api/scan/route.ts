import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { driverIdFromPass, verifyDriverPassCode } from "@/lib/rotating-qr";
export async function POST(req: NextRequest) {
  try {
    await actor(req,["guard","admin"]); const {token}=z.object({token:z.string().max(160)}).parse(await json(req)); const db=adminClient();
    const driverId=driverIdFromPass(token);
    if(!driverId) throw new ApiError(404,"Driver QR is invalid or expired");
    const {data:driver,error}=await db.from("drivers").select("id,full_name,active,qr_active,qr_token,company_id,companies(name)").eq("id",driverId).single();
    if(error || !driver || !driver.active || !driver.qr_active || !verifyDriverPassCode(token,driver.id,driver.qr_token)) throw new ApiError(404,"Driver QR is invalid or expired");
    const {data:lorries,error:lorryError}=await db.from("lorries").select("id,registration_number,vehicle_type,active").eq("assigned_driver_id",driver.id).eq("active",true); if(lorryError) throw lorryError;
    const lorry=lorries?.[0]; if(!lorry) throw new ApiError(409,"No active lorry is assigned to this driver");
    const {data:activeVisit,error:visitError}=await db.from("visits").select("id,visit_code,status").eq("lorry_id",lorry.id).not("status","in",'(COMPLETED,CANCELLED)').maybeSingle(); if(visitError) throw visitError;
    return NextResponse.json({driver:{id:driver.id,full_name:driver.full_name,active:driver.active,qr_active:driver.qr_active,company_id:driver.company_id,companies:driver.companies},lorry,activeVisit});
  } catch(error) { return fail(error); }
}
