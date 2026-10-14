import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const { visit_id } = z.object({ visit_id: z.uuid() }).parse(await json(req));
    const { data, error } = await adminClient().rpc("verify_timed_out_exit", {
      p_visit_id: visit_id, p_actor_id: who.id,
    });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json(data);
  } catch (error) { return fail(error); }
}
