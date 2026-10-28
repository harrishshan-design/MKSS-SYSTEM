import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { contractorDetails } from "@/lib/contractors";
import { siteDate } from "@/lib/date";

export async function GET(req: NextRequest) {
  try {
    const who = await actor(req, ["admin", "monitor"]);
    const { data, error } = await adminClient().rpc("contractor_snapshot", { p_date: siteDate(), p_details: req.nextUrl.searchParams.get("summary") !== "1" });
    if (error) throw error;
    if (who.role !== "admin") data.contractors = data.contractors.map((row: Record<string, unknown>) => {
      const { identity_reference: _ic, auth_user_id: _auth, ...safe } = row; void _ic; void _auth; return safe;
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const who = await actor(req, ["admin"]);
    const body = contractorDetails.extend({ id: z.uuid(), status: z.enum(["PENDING", "APPROVED", "REJECTED", "INACTIVE"]) }).parse(await json(req));
    const { error } = await adminClient().rpc("review_contractor", { p_actor: who.id, p_id: body.id,
      p_name: body.full_name, p_company: body.company_name, p_work: body.work_type, p_status: body.status });
    if (error) throw new ApiError(409, "Could not update contractor. Refresh and retry.");
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
