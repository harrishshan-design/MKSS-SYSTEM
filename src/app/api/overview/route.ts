import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";
export async function GET(req: NextRequest) {
  try {
    const who = await actor(req, ["admin", "guard"]); const db = adminClient();
    const today = siteDate();
    const detail="*,drivers(full_name),lorries(registration_number,vehicle_type),companies(name),security_guards(full_name)";
    const [todayVisits, activeVisits, attendance, queue, metrics] = await Promise.all([
      db.from("visits").select(detail).eq("visit_date", today).order("created_at", { ascending: false }).limit(500),
      db.from("visits").select(detail).not("status","in",'(COMPLETED,CANCELLED)').order("created_at", { ascending: false }).limit(500),
      db.from("security_attendance").select("*,security_guards(full_name)").eq("date",today),
      who.role === "admin" ? db.from("excel_sync_queue").select("id",{count:"exact",head:true}).in("sync_status",["pending","failed"]) : Promise.resolve({ count: 0, error: null }),
      db.rpc("dashboard_metrics",{p_date:today})
    ]);
    if (todayVisits.error || activeVisits.error || attendance.error || queue.error || metrics.error) throw todayVisits.error || activeVisits.error || attendance.error || queue.error || metrics.error;
    const merged=new Map<string,Record<string,unknown>>(); for(const visit of [...(activeVisits.data||[]),...(todayVisits.data||[])]) merged.set(visit.id,visit);
    return NextResponse.json({ visits: [...merged.values()].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))), attendance: attendance.data, syncPending: queue.count || 0, metrics: metrics.data, now: new Date().toISOString() });
  } catch (error) { return fail(error); }
}
