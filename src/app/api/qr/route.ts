import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { randomUUID } from "node:crypto";
import { driverPassCode } from "@/lib/rotating-qr";
export async function GET(req: NextRequest) {
  try {
    await actor(req,["admin"]);
    const driverId=z.uuid().parse(req.nextUrl.searchParams.get("driver_id"));
    const {data,error}=await adminClient().from("drivers").select("id,full_name,qr_token,qr_active").eq("id",driverId).single();
    if(error) throw error;
    return NextResponse.json({id:data.id,full_name:data.full_name,qr_active:data.qr_active,pass_code:data.qr_active?driverPassCode(data.id,data.qr_token):null});
  } catch(error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try { const who=await actor(req,["admin"]); const {driver_id,active}=z.object({driver_id:z.uuid(),active:z.boolean().optional()}).parse(await json(req));
    const db=adminClient(); const {data:old,error:readError}=await db.from("drivers").select("qr_token,qr_active").eq("id",driver_id).single(); if(readError) throw readError;
    const update=active===false ? {qr_active:false} : {qr_token:randomUUID(),qr_active:true};
    const {data,error}=await db.from("drivers").update(update).eq("id",driver_id).select("id,qr_token,qr_active").single(); if(error) throw error;
    await audit(who,active===false?"QR_DEACTIVATED":"QR_GENERATED","drivers",driver_id,{qr_active:old.qr_active},{qr_active:data.qr_active});
    return NextResponse.json({id:data.id,qr_active:data.qr_active});
  } catch(error) { return fail(error); }
}
