import { NextRequest } from "next/server";
import { z } from "zod";
import { actor, fail } from "@/lib/api";
import { downloadArchive } from "@/lib/archives";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const id = z.uuid().parse(req.nextUrl.searchParams.get("batch_id"));
    const generator = downloadArchive(id);
    const first = await generator.next();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { if (!first.done) controller.enqueue(first.value); },
      async pull(controller) { try { const next = await generator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } },
      async cancel() { await generator.return(undefined); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="MKSS_ARCHIVE_${id}.zip"`, "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
