import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";
import { driverIdFromPass, verifyDriverPassCode } from "@/lib/rotating-qr";
export async function POST(req: NextRequest) {
  try {
    const who=await actor(req,["guard"]); if(!who.guard_id) throw new ApiError(403,"Guard profile is missing");
    const {token,purpose}=z.object({token:z.string().max(160),purpose:z.string().max(100).optional()}).parse(await json(req)); const db=adminClient();
    const driverId=driverIdFromPass(token);
    if(!driverId) throw new ApiError(409,"Driver QR is invalid or expired");
    const {data:driver,error:driverError}=await db.from("drivers").select("id,company_id,active,qr_active,qr_token").eq("id",driverId).single();
    if(driverError || !driver?.active || !driver.qr_active || !verifyDriverPassCode(token,driver.id,driver.qr_token)) throw new ApiError(409,"Driver QR is invalid or expired");
    const {data:lorry,error:lorryError}=await db.from("lorries").select("id,company_id,active").eq("assigned_driver_id",driver.id).eq("active",true).single(); if(lorryError || !lorry) throw new ApiError(409,"No active lorry assigned");
    if(lorry.company_id!==driver.company_id) throw new ApiError(409,"Driver and lorry companies do not match");
    const {data:existing}=await db.from("visits").select("id,visit_code,status").eq("lorry_id",lorry.id).not("status","in",'(COMPLETED,CANCELLED)').maybeSingle();
    if(existing) return NextResponse.json({duplicate:true,visit:existing});
    const {data:visit,error}=await db.from("visits").insert({driver_id:driver.id,lorry_id:lorry.id,company_id:driver.company_id,guard_id:who.guard_id,visit_date:siteDate(),purpose:purpose||null,status:"ON_SITE",company_time_in:new Date().toISOString()}).select().single();
    if(error?.code==="23505") { const {data:race}=await db.from("visits").select("id,visit_code,status").eq("lorry_id",lorry.id).not("status","in",'(COMPLETED,CANCELLED)').single(); return NextResponse.json({duplicate:true,visit:race}); }
    if(error) throw error; await audit(who,"ENTRY_CONFIRMED","visits",visit.id,null,visit);
    return NextResponse.json({duplicate:false,visit},{status:201});
  } catch(error) { return fail(error); }
}
