import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";

const action = "DRIVER_DAILY_CHECKIN";
const bodySchema = z.object({ token: z.uuid() });

function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  return [start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString()] as const;
}

export async function GET(req: NextRequest) {
  try {
    const who = await actor(req, ["driver", "admin"]);
    const db = adminClient();
    if (who.role === "driver") {
      if (!who.driver_id) throw new ApiError(403, "Driver profile missing");
      const date = siteDate();
      const [start, end] = dayBounds(date);
      const { data, error } = await db.from("audit_logs").select("id,created_at,new_value")
        .eq("action", action).eq("entity_id", who.driver_id)
        .gte("created_at", start).lt("created_at", end)
        .order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return NextResponse.json({ date, checkin: data?.[0] || null });
    }
    const from = req.nextUrl.searchParams.get("from") || siteDate();
    const to = req.nextUrl.searchParams.get("to") || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
      throw new ApiError(400, "Choose a valid date range");
    const [start] = dayBounds(from);
    const [, end] = dayBounds(to);
    const { data, error } = await db.from("audit_logs").select("id,entity_id,created_at,new_value")
      .eq("action", action).gte("created_at", start).lt("created_at", end)
      .order("created_at", { ascending: false }).limit(5000);
    if (error) throw error;
    return NextResponse.json({ rows: data || [], truncated: (data?.length || 0) === 5000 });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    const who = await actor(req, ["driver"]);
    if (!who.driver_id) throw new ApiError(403, "Driver profile missing");
    const { token } = bodySchema.parse(await json(req));
    const { data, error } = await adminClient().rpc("check_in_driver_and_open_visit", {
      p_actor_id: who.id, p_driver_id: who.driver_id, p_token: token,
    });
    if (error) throw new ApiError(409, error.message);
    return NextResponse.json(data, { status: data?.duplicate ? 200 : 201 });
  } catch (error) { return fail(error); }
}
