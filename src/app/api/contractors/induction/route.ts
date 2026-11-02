import { NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { inductionConfirmation } from "@/lib/contractor-induction";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["contractor"]);
    inductionConfirmation.parse(await json(req));
    const { data, error } = await adminClient().rpc("confirm_contractor_induction", { p_actor: who.id });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json({ person: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
