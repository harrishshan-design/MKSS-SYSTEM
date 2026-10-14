import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, fail, json } from "@/lib/api";
import { sendTestPush } from "@/lib/admin-push";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ endpoint: z.url().max(2048) }).parse(await json(req));
    await sendTestPush(who.id, body.endpoint);
    return NextResponse.json({ sent: true });
  } catch (error) { return fail(error); }
}
