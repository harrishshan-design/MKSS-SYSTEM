import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req:NextRequest) { try { await actor(req,["admin"]); const db=adminClient(); const [connection,queue]=await Promise.all([db.from("microsoft_connections").select("connected_at,updated_at").eq("id",1).maybeSingle(),db.from("excel_sync_queue").select("id,entity_type,sync_status,sync_attempts,last_sync_error,last_sync_time,created_at").order("created_at",{ascending:false}).limit(50)]); if(connection.error||queue.error) throw connection.error||queue.error; return NextResponse.json({connection:connection.data,queue:queue.data}); } catch(error) { return fail(error); } }
