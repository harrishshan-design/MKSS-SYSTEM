import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json, audit } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { archiveStatus, processArchiveStep } from "@/lib/archives";
import { snoozeHours, storageBand } from "@/lib/archive-format";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  try { await actor(req, ["admin"]); return NextResponse.json(await archiveStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return fail(error); }
}
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("start") }), z.object({ action: z.literal("step"), batch_id: z.uuid() }),
  z.object({ action: z.literal("confirm"), batch_id: z.uuid(), saved: z.literal(true) }), z.object({ action: z.literal("snooze") }),
  z.object({ action: z.literal("budget"), limit_mb: z.number().int().min(100).max(10_000_000) }),
  z.object({ action: z.literal("remove_online"), batch_id: z.uuid(), saved_copies: z.literal(true) })]);
export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]), body = schema.parse(await json(req)), db = adminClient();
    if (body.action === "start") { const result = await db.rpc("archive_start", { p_actor: who.id }); if (result.error) throw result.error; }
    if (body.action === "step") { for (let i = 0; i < 3; i++) await processArchiveStep(body.batch_id); }
    if (body.action === "confirm") {
      const updated = await db.from("archive_batches").update({ status: "CLEANING", confirmed_at: new Date().toISOString(), confirmed_by: who.id })
        .eq("id", body.batch_id).eq("status", "READY").not("downloaded_at", "is", null).select("id").maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) throw new ApiError(409, "Download the completed archive and confirm it is saved first");
      await audit(who, "ARCHIVE_CONFIRMED", "archive_batches", body.batch_id, undefined, { saved: true });
    }
    if (body.action === "snooze") {
      const health = await db.rpc("refresh_database_health"); if (health.error) throw health.error;
      const percent = health.data.measured_bytes / health.data.limit_bytes * 100, hours = snoozeHours(percent);
      if (!hours) throw new ApiError(409, percent >= 94 ? "At 94% or more, the storage warning cannot be ignored" : "No critical storage warning is active");
      const result = await db.from("database_health").update({ snoozed_until: new Date(Date.now() + hours * 3_600_000).toISOString(), snoozed_band: storageBand(percent), snoozed_by: who.id }).eq("id", 1);
      if (result.error) throw result.error;
    }
    if (body.action === "budget") {
      const result = await db.from("database_health").update({ limit_bytes: body.limit_mb * 1024 * 1024, snoozed_until: null, snoozed_band: null }).eq("id", 1);
      if (result.error) throw result.error;
      await audit(who, "DATABASE_BUDGET_UPDATED", "database_health", "1", undefined, { limit_mb: body.limit_mb });
    }
    if (body.action === "remove_online") {
      const batch = await db.from("archive_batches").select("status").eq("id", body.batch_id).single();
      if (batch.error || batch.data?.status !== "COMPLETED") throw new ApiError(409, "Only completed archives can have their online copy removed");
      let cursor = 0;
      for (;;) {
        const chunks = await db.from("archive_chunks").select("id,object_path").eq("batch_id", body.batch_id).gt("id", cursor).order("id").limit(100);
        if (chunks.error) throw chunks.error;
        if (!chunks.data?.length) break;
        const removed = await db.storage.from("mkss-archives").remove(chunks.data.map(chunk => chunk.object_path));
        if (removed.error) throw new ApiError(503, "Online copy removal was interrupted. Retry to finish; archive history is retained.");
        cursor = chunks.data.at(-1)!.id;
      }
      const result = await db.from("archive_batches").update({ files_removed_at: new Date().toISOString() }).eq("id", body.batch_id).eq("status", "COMPLETED");
      if (result.error) throw result.error;
      await audit(who, "ARCHIVE_ONLINE_COPY_REMOVED", "archive_batches", body.batch_id);
    }
    return NextResponse.json(await archiveStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
