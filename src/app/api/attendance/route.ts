import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";
import { ensureDailyQr } from "@/lib/daily-qr";
import { dailyCode, verifyDailyCode } from "@/lib/rotating-qr";
export async function GET(req:NextRequest) {
  try { const who=await actor(req,["admin"]); const qr=await ensureDailyQr(who.id); return NextResponse.json({date:qr.date,site:qr.site,code:dailyCode(qr.date,qr.challenge_secret)}); } catch(error) { return fail(error); }
}
export async function POST(req:NextRequest) {
  try { const who=await actor(req,["admin"]); const {site}=z.object({site:z.string().min(2)}).parse(await json(req)); const db=adminClient(); const date=siteDate();
    const {data:existing}=await db.from("attendance_qr").select("*").eq("date",date).maybeSingle(); if(existing) return NextResponse.json({date:existing.date,site:existing.site,code:dailyCode(existing.date,existing.challenge_secret)});
    const {data,error}=await db.from("attendance_qr").insert({date,site,created_by:who.id}).select().single(); if(error) throw error;
    await audit(who,"ATTENDANCE_QR_CREATED","attendance_qr",date,null,{site}); return NextResponse.json({date:data.date,site:data.site,code:dailyCode(data.date,data.challenge_secret)},{status:201});
  } catch(error) { return fail(error); }
}
export async function PUT(req:NextRequest) {
  try { const who=await actor(req,["guard"]); if(!who.guard_id) throw new ApiError(403,"Guard profile missing"); const {token,deviceId}=z.object({token:z.string().max(160),deviceId:z.string().max(100).optional()}).parse(await json(req));
    const db=adminClient(); const date=siteDate(); const {data:qr,error:qrError}=await db.from("attendance_qr").select("*").eq("date",date).single(); if(qrError||!qr||!verifyDailyCode(token,date,qr.challenge_secret)) throw new ApiError(404,"This site QR has expired. Scan the current code.");
    const {data:guard}=await db.from("security_guards").select("shift").eq("id",who.guard_id).single();
    const {data:existing}=await db.from("security_attendance").select("*").eq("date",date).eq("guard_id",who.guard_id).maybeSingle();
    if(!existing) { const {data,error}=await db.from("security_attendance").insert({date,guard_id:who.guard_id,site:qr.site,shift:guard?.shift||null,device_id:deviceId||null}).select().single(); if(error) throw error; await audit(who,"GUARD_CLOCK_IN","security_attendance",data.id,null,data); return NextResponse.json(data); }
    if(existing.time_out) throw new ApiError(409,"Today's attendance is already complete");
    if(Date.now()-new Date(existing.time_in).getTime()<60_000) throw new ApiError(409,"Already clocked in. Please wait before clocking out.");
    const {data,error}=await db.from("security_attendance").update({time_out:new Date().toISOString(),status:"OFF_DUTY"}).eq("id",existing.id).select().single(); if(error) throw error; await audit(who,"GUARD_CLOCK_OUT","security_attendance",data.id,existing,data); return NextResponse.json(data);
  } catch(error) { return fail(error); }
}
