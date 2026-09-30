import { randomUUID } from "node:crypto";
import { adminClient } from "./supabase";
import { graph, mkssHeaders, savedAccessToken, workbookRoot, type Workbook } from "./microsoft-graph";

const layout: Record<string,{sheet:string;headers:string[];select:string;row:(x:Record<string,any>)=>unknown[]}> = {
  visits:{sheet:"DAILY_LORRY_MOVEMENT",headers:["Visit ID","Date","Driver ID","Driver Name","Company","Lorry Registration","Vehicle Type","Security Guard","Security Registration Time","Company Time In","Loading Area In","Loading Area Out","Company Time Out","Loading Duration","Total Site Duration","Final Status"],select:"*,drivers(driver_code,full_name),companies(name),lorries(registration_number,vehicle_type),security_guards(full_name)",row:x=>[x.visit_code,x.visit_date,x.drivers?.driver_code||x.driver_id,x.drivers?.full_name,x.companies?.name,x.lorries?.registration_number,x.lorries?.vehicle_type,x.security_guards?.full_name,x.security_registered_at,x.company_time_in,x.loading_area_in,x.loading_area_out,x.company_time_out,x.loading_duration_seconds,x.total_duration_seconds,x.status]},
  drivers:{sheet:"DRIVERS",headers:["Driver ID","Driver Name","Phone","Company","Licence","Lorry Registration","Vehicle Type","Status","QR ID","Created Date"],select:"*,companies(name),lorries(registration_number,vehicle_type)",row:x=>[x.driver_code||x.id,x.full_name,x.phone,x.companies?.name,x.licence_number,x.lorries?.[0]?.registration_number,x.lorries?.[0]?.vehicle_type,x.active?"ACTIVE":"INACTIVE",x.qr_token,x.created_at]},
  companies:{sheet:"COMPANIES",headers:["Company ID","Company Name","Contact Person","Phone","Email","Status"],select:"*",row:x=>[x.company_code||x.id,x.name,x.contact_person,x.phone,x.email,x.active?"ACTIVE":"INACTIVE"]},
  lorries:{sheet:"LORRIES",headers:["Lorry ID","Registration Number","Company","Vehicle Type","Assigned Driver","Status"],select:"*,companies(name),drivers(full_name)",row:x=>[x.lorry_code||x.id,x.registration_number,x.companies?.name,x.vehicle_type,x.drivers?.full_name,x.active?"ACTIVE":"INACTIVE"]},
  security_attendance:{sheet:"SECURITY_ATTENDANCE",headers:["Attendance ID","Date","Guard ID","Guard Name","Shift","Site","Time In","Time Out","Hours Worked","Status"],select:"*,security_guards(guard_code,full_name)",row:x=>[x.id,x.date,x.security_guards?.guard_code||x.guard_id,x.security_guards?.full_name,x.shift,x.site,x.time_in,x.time_out,x.time_out?Math.round((new Date(x.time_out).getTime()-new Date(x.time_in).getTime())/360000)/10:null,x.status]},
  geofence_events:{sheet:"GEOFENCE_EVENTS",headers:["Event ID","Visit ID","Lorry","Driver","Event Type","Latitude","Longitude","Timestamp","Accuracy","Device ID"],select:"*,visits(visit_code,lorries(registration_number),drivers(full_name))",row:x=>[x.id,x.visits?.visit_code,x.visits?.lorries?.registration_number,x.visits?.drivers?.full_name,x.event_type,x.latitude,x.longitude,x.occurred_at,x.accuracy,x.device_id]}
};
function cell(value:unknown) { if(value===null||value===undefined) return ""; if(typeof value==="number"||typeof value==="boolean") return value; const text=String(value); return /^[=+\-@]/.test(text)?`'${text}`:text; }
export function exportRow(entityType:string,entityId:string,record:Record<string,any>) {
  const spec=layout[entityType]; if(!spec) throw new Error(`Unsupported Excel entity: ${entityType}`);
  const values=spec.row(record).map(cell);
  const details=Object.fromEntries(spec.headers.map((header,index)=>[header,values[index]]));
  const status=record.status || (typeof record.active==="boolean"?(record.active?"ACTIVE":"INACTIVE"):"");
  return [`${entityType}:${entityId}`,entityType,cell(values[0]||entityId),cell(values[1]),cell(status),cell(record.occurred_at||record.updated_at||record.created_at||record.time_in||record.visit_date),JSON.stringify(details),new Date().toISOString()];
}

type SelectedConnection=Workbook&{selectedTargetKind:"worksheet"|"table";selectedTargetId:string};
export async function syncOne(entityType:string,entityId:string,token:string,connection:SelectedConnection) {
  const spec=layout[entityType]; if(!spec) throw new Error(`Unsupported Excel entity: ${entityType}`);
  const db=adminClient();
  const {data:record,error}=await db.from(entityType).select(spec.select).eq("id",entityId).single();
  if(error||!record) throw error||new Error("Record not found");
  const root=workbookRoot(connection);
  const row=exportRow(entityType,entityId,record as Record<string,any>);
  if(connection.selectedTargetKind==="worksheet") {
    const sheet=`${root}/worksheets/${encodeURIComponent(connection.selectedTargetId)}`;
    const header=await graph(token,`${sheet}/range(address='A1:H1')`);
    const headerValues:Array<Array<unknown>>=Array.isArray(header.values)?header.values:[];
    const currentHeaders=headerValues[0]||[];
    const hasContent=currentHeaders.some(value=>value!==null&&value!==undefined&&value!=="");
    if(hasContent&&!mkssHeaders.every((name,index)=>String(currentHeaders[index])===name)) throw new Error("Selected worksheet no longer has MKSS headers");
    if(!hasContent) await graph(token,`${sheet}/range(address='A1:H1')`,"PATCH",{values:[mkssHeaders]});
    let rowNumber=0;
    for(let start=2;start<=100002;start+=500) {
      const end=start+499;
      const range=await graph(token,`${sheet}/range(address='A${start}:H${end}')`);
      const values:Array<Array<unknown>>=Array.isArray(range.values)?range.values:[];
      const matching=values.findIndex(existing=>String(existing?.[0]??"")===row[0]);
      if(matching>=0){rowNumber=start+matching;break;}
      const empty=values.findIndex(existing=>!existing?.some(value=>value!==null&&value!==undefined&&value!==""));
      if(empty>=0){rowNumber=start+empty;break;}
      if(values.length<500){rowNumber=start+values.length;break;}
    }
    if(!rowNumber)throw new Error("Selected worksheet has reached the MKSS row limit");
    await graph(token,`${sheet}/range(address='A${rowNumber}:H${rowNumber}')`,"PATCH",{values:[row]});
    return;
  }

  const table=`${root}/tables/${encodeURIComponent(connection.selectedTargetId)}`;
  const header=await graph(token,`${table}/headerRowRange`);
  if(!mkssHeaders.every((name,index)=>String(header.values?.[0]?.[index])===name)) throw new Error("Selected table no longer has MKSS columns");
  let existingIndex:number|null=null;
  for(let skip=0;skip<100000;skip+=500) {
    const page=await graph(token,`${table}/rows?$top=500&$skip=${skip}`);
    const rows:Array<{index:number;values:unknown[][]}>=Array.isArray(page.value)?page.value:[];
    const found=rows.find(item=>String(item.values?.[0]?.[0])===row[0]);
    if(found){existingIndex=found.index;break;}
    if(rows.length<500)break;
  }
  if(existingIndex!==null) await graph(token,`${table}/rows/${existingIndex}`,"PATCH",{values:[row]});
  else await graph(token,`${table}/rows/add`,"POST",{values:[row]});
}

export async function processSyncQueue(limit=10) {
  const db=adminClient();
  const owner=randomUUID();
  const {data:acquired,error}=await db.rpc("acquire_excel_worker_lock",{p_owner:owner});
  if(error)throw error;
  if(!acquired)return {synced:0,failed:0,waiting:true};
  try { return await processSyncQueueUnlocked(limit); }
  finally { const {error:releaseError}=await db.rpc("release_excel_worker_lock",{p_owner:owner}); if(releaseError)console.error("Could not release Excel worker lock",releaseError); }
}

async function processSyncQueueUnlocked(limit:number) {
  const db=adminClient();
  const now=new Date().toISOString();
  const {error:timedOutError}=await db.from("excel_sync_queue").update({sync_status:"pending",last_sync_error:"Worker timed out"}).eq("sync_status","processing").lt("next_attempt_at",now);
  if(timedOutError)throw timedOutError;
  const {data:rawConnection,error:connectionError}=await db.from("microsoft_connections").select("drive_id,workbook_item_id,selected_target_kind,selected_target_id").eq("id",1).maybeSingle();
  if(connectionError)throw connectionError;
  if(!rawConnection?.drive_id||!rawConnection.workbook_item_id||!rawConnection.selected_target_kind||!rawConnection.selected_target_id)return {synced:0,failed:0,waiting:true};
  let token:string;
  try { token=await savedAccessToken(); } catch { return {synced:0,failed:0,waiting:true}; }
  const connection:SelectedConnection={driveId:rawConnection.drive_id,itemId:rawConnection.workbook_item_id,name:"",webUrl:null,selectedTargetKind:rawConnection.selected_target_kind,selectedTargetId:rawConnection.selected_target_id};
  const {data:items,error}=await db.from("excel_sync_queue").select("*").in("sync_status",["pending","failed"]).lte("next_attempt_at",now).order("created_at").limit(limit);
  if(error)throw error;
  let synced=0,failed=0;
  for(const item of items||[]) {
    const attempts=item.sync_attempts+1;
    const {data:claimed,error:claimError}=await db.from("excel_sync_queue").update({sync_status:"processing",sync_attempts:attempts,next_attempt_at:new Date(Date.now()+10*60_000).toISOString()}).eq("id",item.id).in("sync_status",["pending","failed"]).select("id").maybeSingle();
    if(claimError)throw claimError;
    if(!claimed)continue;
    const {data:liveConnection,error:liveError}=await db.from("microsoft_connections").select("drive_id,workbook_item_id,selected_target_kind,selected_target_id").eq("id",1).maybeSingle();
    if(liveError)throw liveError;
    if(!liveConnection || liveConnection.drive_id!==connection.driveId || liveConnection.workbook_item_id!==connection.itemId || liveConnection.selected_target_kind!==connection.selectedTargetKind || liveConnection.selected_target_id!==connection.selectedTargetId) {
      const {error:restoreError}=await db.from("excel_sync_queue").update({sync_status:"pending",next_attempt_at:new Date().toISOString()}).eq("id",item.id);
      if(restoreError)throw restoreError;
      return {synced,failed,waiting:true};
    }
    try {
      await syncOne(item.entity_type,item.entity_id,token,connection);
      const {error:doneError}=await db.from("excel_sync_queue").update({sync_status:"synced",last_sync_error:null,last_sync_time:new Date().toISOString()}).eq("id",item.id);
      if(doneError)throw doneError;
      synced++;
    } catch(error) {
      const {error:retryError}=await db.from("excel_sync_queue").update({sync_status:"pending",last_sync_error:(error instanceof Error?error.message:String(error)).slice(0,1000),next_attempt_at:new Date(Date.now()+Math.min(60,2**Math.min(attempts,6))*60_000).toISOString()}).eq("id",item.id);
      if(retryError)throw retryError;
      failed++;
    }
  }
  return {synced,failed};
}
