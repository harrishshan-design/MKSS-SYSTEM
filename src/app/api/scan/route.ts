import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function POST(req: NextRequest) {
  try {
    await actor(req,["guard","admin"]); const {token}=z.object({token:z.uuid()}).parse(await json(req)); const db=adminClient();
    const {data:driver,error}=await db.from("drivers").select("id,full_name,active,qr_active,company_id,companies(name)").eq("qr_token",token).single();
    if(error || !driver || !driver.qr_active) throw new ApiError(404,"QR code is invalid or inactive");
    const {data:lorries,error:lorryError}=await db.from("lorries").select("id,registration_number,vehicle_type,active").eq("assigned_driver_id",driver.id).eq("active",true); if(lorryError) throw lorryError;
    const lorry=lorries?.[0]; if(!lorry) throw new ApiError(409,"No active lorry is assigned to this driver");
    const {data:activeVisit,error:visitError}=await db.from("visits").select("id,visit_code,status").eq("lorry_id",lorry.id).not("status","in",'(COMPLETED,CANCELLED)').maybeSingle(); if(visitError) throw visitError;
    return NextResponse.json({driver,lorry,activeVisit});
  } catch(error) { return fail(error); }
}
