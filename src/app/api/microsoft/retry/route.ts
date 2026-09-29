import { NextRequest, NextResponse } from "next/server";
import { actor, audit, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { processSyncQueue } from "@/lib/excel";
export async function POST(req:NextRequest) { try { const who=await actor(req,["admin"]); await adminClient().from("excel_sync_queue").update({next_attempt_at:new Date().toISOString()}).eq("sync_status","failed"); const result=await processSyncQueue(); await audit(who,"EXCEL_SYNC_RETRY","excel_sync_queue","batch",null,result); return NextResponse.json(result); } catch(error) { return fail(error); } }
