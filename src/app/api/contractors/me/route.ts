import { NextRequest, NextResponse } from "next/server";
import { contractorAttendanceScan } from "@/lib/contractors";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { ensureDailyQr, siteBackupQr } from "@/lib/daily-qr";
import { verifyBackupCode, verifyDailyCode } from "@/lib/rotating-qr";
import { siteDate } from "@/lib/date";

export async function GET(req: NextRequest) {
  try {
    const who = await actor(req, ["contractor"]);
    const db = adminClient();
    const [person, attendance] = await Promise.all([
      db.from("contractors").select("id,full_name,company_name,work_type,status").eq("auth_user_id", who.id).single(),
      db.from("contractor_attendance").select("id,date,time_in,time_out,site,pass_id").eq("contractor_id", who.contractor_id).eq("date", siteDate()).maybeSingle(),
    ]);
    if (person.error || attendance.error) throw person.error || attendance.error;
    return NextResponse.json({ person: person.data, attendance: attendance.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["contractor"]);
    const body = contractorAttendanceScan.parse(await json(req));
    const [qr, backup] = await Promise.all([ensureDailyQr(), siteBackupQr()]);
    if (!verifyDailyCode(body.token, qr.date, qr.challenge_secret) && !verifyBackupCode(body.token, backup))
      throw new ApiError(409, "Invalid site QR. Scan today's daily or backup QR.");
    const { data, error } = await adminClient().rpc("scan_contractor_attendance", { p_actor: who.id, p_site: qr.site, p_action: body.action, p_pass_id: body.pass_id ?? null });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json({ attendance: data });
  } catch (error) { return fail(error); }
}
