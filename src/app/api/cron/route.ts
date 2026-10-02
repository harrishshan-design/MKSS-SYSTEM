import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
import { delayedStatus } from "@/lib/geofence";
import { processSyncQueue } from "@/lib/excel";
import { ensureDailyQr } from "@/lib/daily-qr";
export async function GET(req:NextRequest) { if(!process.env.CRON_SECRET||req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:"Unauthorized"},{status:401});
  const dailyQr=await ensureDailyQr(); const db=adminClient(); const [{data:settings},{data:visits}]=await Promise.all([db.from("settings").select("delay_threshold_minutes").eq("id",1).single(),db.from("visits").select("*").is("company_time_out",null).not("company_time_in","is",null).not("status","in",'(COMPLETED,CANCELLED)').limit(500)]);
  let delayed=0; for(const visit of visits||[]) if(delayedStatus(visit,settings?.delay_threshold_minutes||120)==="DELAYED"&&visit.status!=="DELAYED") { await db.from("visits").update({status:"DELAYED"}).eq("id",visit.id); delayed++; }
  const excel=await processSyncQueue(); return NextResponse.json({dailyQrDate:dailyQr.date,delayed,excel});
}
