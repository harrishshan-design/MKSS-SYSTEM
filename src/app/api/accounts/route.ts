import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function POST(req:NextRequest) {
  try { const who=await actor(req,["admin"]); const body=z.object({email:z.email(),role:z.enum(["guard","driver"]),record_id:z.uuid()}).parse(await json(req)); const db=adminClient();
    const table=body.role==="guard"?"security_guards":"drivers";
    const {data:record,error:recordError}=await db.from(table).select("id,full_name,active").eq("id",body.record_id).single(); if(recordError||!record?.active) throw new ApiError(409,"Select an active guard or driver");
    const {data:existing}=await db.from("users").select("id").eq(body.role==="guard"?"guard_id":"driver_id",body.record_id).maybeSingle(); if(existing) throw new ApiError(409,"This person already has a login");
    const {data:invited,error:inviteError}=await db.auth.admin.inviteUserByEmail(body.email); if(inviteError||!invited.user) throw inviteError||new Error("Invite failed");
    const profile={id:invited.user.id,name:record.full_name,role:body.role,...(body.role==="guard"?{guard_id:record.id}:{driver_id:record.id})};
    const {error:profileError}=await db.from("users").insert(profile as Record<string, unknown>); if(profileError) throw profileError;
    await audit(who,"ACCOUNT_INVITED","users",invited.user.id,null,{email:body.email,role:body.role,record_id:body.record_id});
    return NextResponse.json({ok:true,email:body.email},{status:201});
  } catch(error) { return fail(error); }
}
