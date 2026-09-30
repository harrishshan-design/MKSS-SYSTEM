import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
import { encrypt, exchangeCode, listDestinations, MicrosoftConnectionError, resolveSharedWorkbook, stateHash, type ConnectionStatus } from "@/lib/microsoft-graph";

export async function GET(req: NextRequest) {
  const home = new URL("/?section=settings", req.nextUrl.origin);
  const cookieState = req.cookies.get("mkss_ms_oauth")?.value || "";
  const returnedState = req.nextUrl.searchParams.get("state") || "";
  const code = req.nextUrl.searchParams.get("code");
  let result: ConnectionStatus = "authentication_required";

  if (cookieState && returnedState && code && cookieState.length === returnedState.length && timingSafeEqual(Buffer.from(cookieState), Buffer.from(returnedState))) {
    const db = adminClient();
    const hash = stateHash(returnedState);
    try {
      const { data: attempt, error } = await db.from("microsoft_oauth_attempts").select("actor_id,share_url,code_verifier,expires_at").eq("state_hash", hash).maybeSingle();
      if (error) throw error;
      const { error: deleteError } = await db.from("microsoft_oauth_attempts").delete().eq("state_hash", hash);
      if (deleteError) throw deleteError;
      if (!attempt || new Date(attempt.expires_at).getTime() < Date.now()) throw new MicrosoftConnectionError("authentication_required", "Microsoft sign-in expired");
      const { data: user, error: userError } = await db.from("users").select("role,active").eq("id", attempt.actor_id).single();
      if (userError || user?.role !== "admin" || !user.active) throw new MicrosoftConnectionError("permission_denied", "Active administrator required");
      const tokens = await exchangeCode(code, attempt.code_verifier);
      const workbook = await resolveSharedWorkbook(tokens.accessToken, attempt.share_url);
      await listDestinations(tokens.accessToken, workbook);
      const { data: prior, error: priorError } = await db.from("microsoft_connections").select("drive_id,workbook_item_id,selected_target_kind,selected_target_id,selected_target_name").eq("id", 1).maybeSingle();
      if (priorError) throw priorError;
      const sameWorkbook = prior?.drive_id === workbook.driveId && prior?.workbook_item_id === workbook.itemId;
      const { error: saveError } = await db.from("microsoft_connections").upsert({
        id: 1,
        encrypted_refresh_token: encrypt(tokens.refreshToken),
        connected_by: attempt.actor_id,
        share_url: attempt.share_url,
        drive_id: workbook.driveId,
        workbook_item_id: workbook.itemId,
        workbook_name: workbook.name,
        workbook_web_url: workbook.webUrl,
        selected_target_kind: sameWorkbook ? prior?.selected_target_kind : null,
        selected_target_id: sameWorkbook ? prior?.selected_target_id : null,
        selected_target_name: sameWorkbook ? prior?.selected_target_name : null,
        updated_at: new Date().toISOString(),
      });
      if (saveError) throw saveError;
      result = "connected";
    } catch (error) {
      result = error instanceof MicrosoftConnectionError ? error.code : "workbook_inaccessible";
      console.error("Microsoft connection failed", error);
    }
  }
  home.searchParams.set("excel", result);
  const response = NextResponse.redirect(home);
  response.cookies.delete("mkss_ms_oauth");
  return response;
}
