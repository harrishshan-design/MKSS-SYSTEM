import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req:NextRequest) { try { await actor(req,["admin"]); const db=adminClient(); const [settings,fences]=await Promise.all([db.from("settings").select("*").eq("id",1).single(),db.from("geofences").select("*")]); if(settings.error||fences.error) throw settings.error||fences.error; return NextResponse.json({settings:settings.data,fences:fences.data}); } catch(error) { return fail(error); } }
export async function PUT(req:NextRequest) {
  try { const who=await actor(req,["admin"]); const body=z.object({exit_confirmation_seconds:z.number().int().min(30).max(900),exit_radius_meters:z.number().int().min(500).max(50000),delay_threshold_minutes:z.number().int().min(15).max(1440),fences:z.array(z.object({kind:z.enum(["company","loading"]),name:z.string().min(2),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),radius_meters:z.number().int().min(10).max(10000),enabled:z.boolean()}))}).parse(await json(req));
    const company=body.fences.find(fence=>fence.kind==="company");
    if(!company?.enabled || (company.latitude===0 && company.longitude===0))
      throw new ApiError(400,"Enter the real company site latitude and longitude before saving the geofence");
    const db=adminClient(); const {data:old}=await db.from("settings").select("*").eq("id",1).single(); const {error}=await db.from("settings").update({exit_confirmation_seconds:body.exit_confirmation_seconds,exit_radius_meters:body.exit_radius_meters,delay_threshold_minutes:body.delay_threshold_minutes}).eq("id",1); if(error) throw error;
    for(const fence of body.fences) { const {error:fenceError}=await db.from("geofences").upsert(fence,{onConflict:"kind"}); if(fenceError) throw fenceError; }
    await audit(who,"SETTINGS_UPDATED","settings","1",old,body); return NextResponse.json({ok:true});
  } catch(error) { return fail(error); }
}
