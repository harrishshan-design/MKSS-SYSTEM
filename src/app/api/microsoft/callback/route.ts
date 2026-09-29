import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/supabase";
import { encrypt, exchangeCode, microsoftConfig } from "@/lib/excel";
export async function GET(req:NextRequest) { const c=microsoftConfig(); const home=new URL("/?section=integrations",c.appUrl); const raw=req.cookies.get("mkss_ms_oauth")?.value||""; const [state,userId]=raw.split(":"); const returned=req.nextUrl.searchParams.get("state")||""; const code=req.nextUrl.searchParams.get("code");
  if(!state||!userId||!returned||!code||state.length!==returned.length||!timingSafeEqual(Buffer.from(state),Buffer.from(returned))) { home.searchParams.set("excel","invalid_callback"); return NextResponse.redirect(home); }
  try { const db=adminClient(); const {data:user}=await db.from("users").select("role,active").eq("id",userId).single(); if(user?.role!=="admin"||!user.active) throw new Error("Admin account required"); const refreshToken=await exchangeCode(code); const {error}=await db.from("microsoft_connections").upsert({id:1,encrypted_refresh_token:encrypt(refreshToken),connected_by:userId,updated_at:new Date().toISOString()}); if(error) throw error; home.searchParams.set("excel","connected"); }
  catch(error) { console.error(error); home.searchParams.set("excel","failed"); }
  const response=NextResponse.redirect(home); response.cookies.delete("mkss_ms_oauth"); return response;
}
