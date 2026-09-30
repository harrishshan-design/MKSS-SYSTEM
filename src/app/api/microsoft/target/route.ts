import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { listDestinations, savedAccessToken, validateDestination } from "@/lib/microsoft-graph";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ kind: z.enum(["worksheet", "table"]), id: z.string().min(1).max(256) }).parse(await json(req));
    const db = adminClient();
    const { data: connection, error } = await db.from("microsoft_connections")
      .select("drive_id,workbook_item_id,workbook_name,workbook_web_url")
      .eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!connection?.drive_id || !connection.workbook_item_id) throw new ApiError(409, "Connect a workbook first");
    const token = await savedAccessToken();
    const workbook = { driveId: connection.drive_id, itemId: connection.workbook_item_id, name: connection.workbook_name || "Excel workbook", webUrl: connection.workbook_web_url };
    const destinations = await listDestinations(token, workbook);
    const target = destinations.find(item => item.kind === body.kind && item.id === body.id);
    if (!target) throw new ApiError(404, "Worksheet or table not found in the connected workbook");
    await validateDestination(token, workbook, target);
    const { data: count, error: saveError } = await db.rpc("set_excel_destination", { p_actor_id: who.id, p_kind: target.kind, p_target_id: target.id, p_target_name: target.name });
    if (saveError) throw saveError;
    const queued = Number(count || 0);
    await audit(who, "MICROSOFT_TARGET_SELECTED", "microsoft_connections", "1", null, { kind: target.kind, name: target.name, queued });
    return NextResponse.json({ ok: true, target, queued });
  } catch (error) { return fail(error); }
}
