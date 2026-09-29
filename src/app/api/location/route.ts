import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { evaluateGeofences } from "@/lib/geofence";
import type { Fence, Position, Visit } from "@/lib/types";
const schema=z.object({visit_id:z.uuid(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().min(0).max(1000),timestamp:z.iso.datetime(),deviceId:z.string().max(100).optional()});
export async function POST(req: NextRequest) {
  try {
    const who=await actor(req,["driver"]); const body=schema.parse(await json(req));
    if(Math.abs(Date.now()-new Date(body.timestamp).getTime())>5*60_000) throw new ApiError(400,"Location timestamp must be within five minutes of server time");
    if(body.accuracy>100) throw new ApiError(422,"Location accuracy is too low. Move outdoors and try again.");
    const db=adminClient(); const {data:visit,error}=await db.from("visits").select("*").eq("id",body.visit_id).single(); if(error) throw error;
    if(visit.driver_id!==who.driver_id) throw new ApiError(403,"This visit belongs to another driver");
    if(visit.last_location_at && new Date(body.timestamp)<=new Date(visit.last_location_at)) throw new ApiError(409,"Stale location update");
    const [{data:fences,error:fenceError},{data:settings,error:settingsError}]=await Promise.all([db.from("geofences").select("*").eq("enabled",true),db.from("settings").select("*").eq("id",1).single()]);
    if(fenceError||settingsError) throw fenceError||settingsError;
    const company=fences?.find(f=>f.kind==="company") as Fence|undefined;
    if(!company) throw new ApiError(409,"Company geofence is not configured");
    const loading=fences?.find(f=>f.kind==="loading") as Fence|undefined;
    const position:Position=body;
    const {patch,events}=evaluateGeofences(visit as Visit,position,company,loading,settings.exit_confirmation_seconds);
    if(Object.keys(patch).length===0) return NextResponse.json({visit,events:[]});
    const {data:updated,error:updateError}=await db.rpc("apply_location_transition",{
      p_visit_id:visit.id,p_expected_updated_at:visit.updated_at,p_patch:patch,p_events:events,
      p_latitude:position.latitude,p_longitude:position.longitude,p_accuracy:position.accuracy,
      p_device_id:position.deviceId||null,p_occurred_at:position.timestamp
    });
    if(updateError||!updated) {
      if(updateError?.code==="40001") throw new ApiError(409,"Concurrent location update. Retry with a fresh position.");
      throw updateError||new Error("Location transition failed");
    }
    if(events.length) {
      await audit(who,events.includes("COMPANY_EXIT_CONFIRMED")?"AUTOMATIC_CHECKOUT":"GEOFENCE_TRANSITION","visits",visit.id,{status:visit.status},{status:updated.status,events});
    }
    return NextResponse.json({visit:updated,events});
  } catch(error) { return fail(error); }
}
