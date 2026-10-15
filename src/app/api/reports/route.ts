import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";
import { loadDailyReport } from "@/lib/reports";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin", "monitor"]);
    const now = new Date();
    const report = await loadDailyReport(adminClient(), siteDate(now), now.toISOString());
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
