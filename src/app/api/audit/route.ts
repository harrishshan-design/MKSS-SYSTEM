import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
export async function GET(req:NextRequest){try{await actor(req,["admin"]);const {data,error}=await adminClient().from("audit_logs").select("*,users(name)").order("created_at",{ascending:false}).limit(500);if(error)throw error;return NextResponse.json(data);}catch(error){return fail(error);}}
