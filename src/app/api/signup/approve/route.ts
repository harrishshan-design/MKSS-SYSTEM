import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = z.object({ request_id: z.uuid(), company_id: z.uuid(), lorry_id: z.uuid() }).parse(await json(req));
    const { data, error } = await adminClient().rpc("approve_driver_registration", {
      p_request_id: body.request_id,
      p_company_id: body.company_id,
      p_lorry_id: body.lorry_id,
      p_actor_id: who.id,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, driver_id: data });
  } catch (error) { return fail(error); }
}
