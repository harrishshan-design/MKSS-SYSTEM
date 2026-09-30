import { NextRequest, NextResponse } from "next/server";
import { actor, audit, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function DELETE(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const db = adminClient();
    const { error } = await db.from("microsoft_connections").delete().eq("id", 1);
    if (error) throw error;
    const { error: attemptError } = await db.from("microsoft_oauth_attempts").delete().eq("actor_id", who.id);
    if (attemptError) throw attemptError;
    await audit(who, "MICROSOFT_DISCONNECTED", "microsoft_connections", "1");
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
