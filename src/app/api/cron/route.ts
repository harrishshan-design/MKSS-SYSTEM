import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";
import { delayedStatus } from "@/lib/geofence";
import { ensureDailyQr } from "@/lib/daily-qr";
import { processArchiveStep } from "@/lib/archives";
import { processApprovalPush } from "@/lib/admin-push";
export async function GET(req:NextRequest) { if(!process.env.CRON_SECRET||req.headers.get("authorization")!==`Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({error:"Unauthorized"},{status:401});
  const dailyQr=await ensureDailyQr(); const db=adminClient(); const [{data:settings},{data:visits}]=await Promise.all([db.from("settings").select("delay_threshold_minutes").eq("id",1).single(),db.from("visits").select("*").is("company_time_out",null).not("company_time_in","is",null).not("status","in",'(COMPLETED,CANCELLED)').limit(500)]);
  let delayed=0; for(const visit of visits||[]) if(delayedStatus(visit,settings?.delay_threshold_minutes||120)==="DELAYED"&&visit.status!=="DELAYED") { await db.from("visits").update({status:"DELAYED"}).eq("id",visit.id); delayed++; }
  let phoneAlerts: Awaited<ReturnType<typeof processApprovalPush>> | { error: string };
  try { phoneAlerts = await processApprovalPush(); }
  catch (error) { console.error("Admin phone alert retry failed", error); phoneAlerts = { error: "Retry failed" }; }
  const maintenance=await db.rpc("expire_idle_drivers");
  const health=await db.rpc("refresh_database_health");
  const jobs=await db.from("archive_batches").select("id").in("status",["EXPORTING","CLEANING"]);
  for(const job of jobs.data||[]) { try { for(let i=0;i<3;i++)await processArchiveStep(job.id); } catch(error) { console.error("Archive resume failed",error); } }
  return NextResponse.json({dailyQrDate:dailyQr.date,delayed,phoneAlerts,expiredDrivers:maintenance.data,healthChecked:!health.error});
}
