import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";
export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin", "monitor", "guard"]); const db = adminClient();
    const today = siteDate();
    const snapshot = await db.rpc("operations_snapshot", { p_date: today });
    if (!snapshot.error) return NextResponse.json(snapshot.data, { headers: { "Cache-Control": "private, no-store" } });
    // Keep the old read path available during a staged database rollout.
    if (!["PGRST202", "42883"].includes(snapshot.error.code)) throw snapshot.error;
    const detail="*,drivers(full_name),lorries(registration_number,vehicle_type),companies(name),security_guards(full_name)";
    const [todayVisits, activeVisits, unverifiedVisits, attendance, metrics, companyFence, guards] = await Promise.all([
      db.from("visits").select(detail).eq("visit_date", today).order("created_at", { ascending: false }).limit(500),
      db.from("visits").select(detail).not("status","in",'(COMPLETED,CANCELLED)').order("created_at", { ascending: false }).limit(500),
      db.from("visits").select(detail).eq("status","COMPLETED").eq("checkout_method","TIME_LIMIT").order("created_at", { ascending: false }).limit(500),
      db.from("security_attendance").select("*,security_guards(full_name)").eq("date",today),
      db.rpc("dashboard_metrics",{p_date:today}),
      db.from("geofences").select("id",{count:"exact",head:true}).eq("kind","company").eq("enabled",true),
      db.from("security_guards").select("id",{count:"exact",head:true}).eq("active",true),
    ]);
    if (todayVisits.error || activeVisits.error || unverifiedVisits.error || attendance.error || metrics.error || companyFence.error || guards.error) throw todayVisits.error || activeVisits.error || unverifiedVisits.error || attendance.error || metrics.error || companyFence.error || guards.error;
    const merged=new Map<string,Record<string,unknown>>(); for(const visit of [...(unverifiedVisits.data||[]),...(activeVisits.data||[]),...(todayVisits.data||[])]) merged.set(visit.id,visit);
    return NextResponse.json({ visits: [...merged.values()].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))), attendance: attendance.data, metrics: metrics.data, monitoring: { companyFenceConfigured: (companyFence.count || 0) > 0, activeGuards: guards.count || 0 }, now: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error); }
}
