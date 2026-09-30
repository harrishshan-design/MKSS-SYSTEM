import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { createOAuthSecrets, microsoftConfig, microsoftSetup, stateHash, validateSpreadsheetLink } from "@/lib/microsoft-graph";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ share_url: z.string().max(4096).optional() }).parse(await json(req));
    const db = adminClient();
    let suppliedUrl = body.share_url?.trim();
    if (!suppliedUrl) {
      const { data: existing, error: existingError } = await db.from("microsoft_connections").select("share_url").eq("id", 1).maybeSingle();
      if (existingError) throw existingError;
      suppliedUrl = existing?.share_url || "";
    }
    const shareUrl = validateSpreadsheetLink(suppliedUrl || "");
    const setup = microsoftSetup(req.nextUrl.origin);
    if (!setup.ready) throw new ApiError(503, `Microsoft setup incomplete: ${[...setup.missing, ...setup.issues].join(", ")}`);
    const config = microsoftConfig();
    const { error: cleanupError } = await db.from("microsoft_oauth_attempts").delete().lt("expires_at", new Date().toISOString());
    if (cleanupError) throw cleanupError;
    const { state, verifier, challenge } = createOAuthSecrets();
    const { error } = await db.from("microsoft_oauth_attempts").insert({ state_hash: stateHash(state), actor_id: who.id, share_url: shareUrl, code_verifier: verifier, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    if (error) throw error;
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: `${config.appUrl}/api/microsoft/callback`, response_mode: "query", scope: "offline_access Files.ReadWrite User.Read", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set("mkss_ms_oauth", state, { httpOnly: true, secure: config.appUrl.startsWith("https:"), sameSite: "lax", path: "/api/microsoft/callback", maxAge: 600 });
    return response;
  } catch (error) { return fail(error); }
}
