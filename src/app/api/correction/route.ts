import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function POST(req:NextRequest) {
  try { const who=await actor(req,["admin"]); const body=z.object({visit_id:z.uuid(),action:z.enum(["checkout","cancel","correct_entry","correct_exit"]),timestamp:z.iso.datetime().optional(),reason:z.string().min(8).max(500)}).parse(await json(req));
    const {data,error}=await adminClient().rpc("apply_manual_correction",{p_visit_id:body.visit_id,p_action:body.action,p_time:body.timestamp||new Date().toISOString(),p_reason:body.reason,p_actor_id:who.id});
    if(error) throw error; return NextResponse.json(data);
  } catch(error) { return fail(error); }
}
