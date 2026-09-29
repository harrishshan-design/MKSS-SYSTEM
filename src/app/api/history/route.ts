import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req:NextRequest) { try { await actor(req,["admin"]); const from=req.nextUrl.searchParams.get("from"),to=req.nextUrl.searchParams.get("to"); let query=adminClient().from("visits").select("*,drivers(full_name),lorries(registration_number,vehicle_type),companies(name),security_guards(full_name)").order("created_at",{ascending:false}).limit(1000); if(from) query=query.gte("visit_date",from); if(to) query=query.lte("visit_date",to); const {data,error}=await query; if(error) throw error; return NextResponse.json(data); } catch(error) { return fail(error); } }
