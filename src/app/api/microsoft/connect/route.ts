import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { actor, fail } from "@/lib/api";
import { microsoftConfig } from "@/lib/excel";
export async function GET(req:NextRequest) { try { const who=await actor(req,["admin"]); const c=microsoftConfig(); const state=randomBytes(24).toString("hex"); const url=new URL(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/authorize`); url.search=new URLSearchParams({client_id:c.clientId,response_type:"code",redirect_uri:`${c.appUrl}/api/microsoft/callback`,response_mode:"query",scope:"offline_access Files.ReadWrite User.Read",state}).toString(); const response=NextResponse.json({url:url.toString()}); response.cookies.set("mkss_ms_oauth",`${state}:${who.id}`,{httpOnly:true,secure:c.appUrl.startsWith("https"),sameSite:"lax",path:"/api/microsoft/callback",maxAge:600}); return response; } catch(error) { return fail(error); } }
