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
    const db = adminClient();
    const date = siteDate();
    const { data: qr, error: qrError } = await db.from("attendance_qr")
      .select("date,site").eq("date", date).eq("token", token).maybeSingle();
    if (qrError) throw qrError;
    if (!qr) throw new ApiError(400, "This is not today's site QR. Ask the administrator for the current code.");
    const { data: driver, error: driverError } = await db.from("drivers")
      .select("id,full_name,active,company_id,companies(name),lorries(registration_number,active)")
      .eq("id", who.driver_id).single();
    if (driverError) throw driverError;
    if (!driver.active) throw new ApiError(403, "Driver account is inactive");
    const lorry = driver.lorries?.find((item: { active: boolean }) => item.active);
    if (!lorry) throw new ApiError(409, "Ask the administrator to assign your lorry before checking in");
    const [start, end] = dayBounds(date);
    const { data: existing, error: existingError } = await db.from("audit_logs")
      .select("id,created_at,new_value").eq("action", action).eq("entity_id", who.driver_id)
      .gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return NextResponse.json({ duplicate: true, checkin: existing[0] });
    const company = Array.isArray(driver.companies) ? driver.companies[0] : driver.companies;
    const details = { date, site: qr.site, driver: driver.full_name,
      company: company?.name || "", lorry: lorry.registration_number };
    const { data: checkin, error } = await db.from("audit_logs").insert({
      actor_id: who.id, action, entity_type: "drivers", entity_id: who.driver_id,
      new_value: details,
    }).select("id,created_at,new_value").single();
    if (error) throw error;
    return NextResponse.json({ duplicate: false, checkin }, { status: 201 });
  } catch (error) { return fail(error); }
}
