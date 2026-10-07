import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["guard"]);
    const body = z.object({ visit_id: z.uuid(), stage: z.enum(["start", "finish"]) }).parse(await json(req));
    const { data: visit, error } = await adminClient().rpc("confirm_guard_loading_stage", {
      p_actor_id: who.id, p_visit_id: body.visit_id, p_stage: body.stage,
    });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json({ visit });
  } catch (error) { return fail(error); }
}
