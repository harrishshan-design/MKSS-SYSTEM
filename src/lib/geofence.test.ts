import { describe, expect, it } from "vitest";
import { delayedStatus, evaluateGeofences, insideFence, metersBetween } from "./geofence";
import type { Fence, Position, Visit } from "./types";
const company:Fence={id:"site",kind:"company",name:"Site",latitude:3.0,longitude:101.0,radius_meters:200,enabled:true};
const loading:Fence={id:"zone",kind:"loading",name:"Loading",latitude:3.0,longitude:101.0,radius_meters:70,enabled:true};
const position=(longitude:number,time:string,accuracy=5):Position=>({latitude:3,longitude,accuracy,timestamp:time,deviceId:"test"});
const visit=(changes:Partial<Visit>={}):Visit=>({id:"v",visit_code:"VIS-1",driver_id:"d",lorry_id:"l",company_id:"c",guard_id:"g",visit_date:"2026-09-29",purpose:null,security_registered_at:"2026-09-29T00:00:00Z",company_time_in:null,loading_area_in:null,loading_area_out:null,company_time_out:null,loading_duration_seconds:null,total_duration_seconds:null,status:"REGISTERED",exit_pending_at:null,latitude_last:null,longitude_last:null,last_location_at:null,last_observed_at:null,created_at:"2026-09-29T00:00:00Z",updated_at:"2026-09-29T00:00:00Z",...changes});
describe("geofence transitions",()=>{
  it("respects GPS uncertainty at the edge",()=>{const edge=position(101+200/111000,"2026-09-29T00:00:00Z");expect(insideFence(edge,company).inside).toBe(false);expect(metersBetween(company,edge)).toBeGreaterThan(190);});
  it("records company and loading entry",()=>{const result=evaluateGeofences(visit(),position(101,"2026-09-29T00:01:00Z"),company,loading,120);expect(result.events).toEqual(["COMPANY_ENTER","LOADING_ZONE_ENTER"]);expect(result.patch.status).toBe("LOADING_UNLOADING");});
  it("keeps a visit open before 30 seconds and cancels departure on return",()=>{const initial=visit({company_time_in:"2026-09-29T00:01:00Z",status:"ON_SITE"});const pending=evaluateGeofences(initial,position(101.004,"2026-09-29T00:01:10Z"),company,loading,30,200);expect(pending.events).toEqual(["COMPANY_EXIT_PENDING"]);expect(pending.patch.company_time_out).toBeUndefined();const returned=evaluateGeofences({...initial,exit_pending_at:"2026-09-29T00:01:10Z"},position(101.001,"2026-09-29T00:01:20Z"),company,loading,30,200);expect(returned.events).toContain("COMPANY_EXIT_CANCELLED");expect(returned.patch.company_time_out).toBeUndefined();});
  it("uses the first fresh reading beyond 200 m after 30 seconds",()=>{const initial=visit({company_time_in:"2026-09-29T00:01:00Z",status:"ON_SITE"});const early=evaluateGeofences(initial,position(101.004,"2026-09-29T00:01:29Z"),company,loading,30,200);expect(early.patch.company_time_out).toBeUndefined();const done=evaluateGeofences(initial,position(101.004,"2026-09-29T00:01:30Z"),company,loading,30,200);expect(done.events).toContain("COMPANY_EXIT_CONFIRMED");expect(done.patch.status).toBe("COMPLETED");expect(done.patch.total_duration_seconds).toBe(30);});
  it("waits for GPS accuracy to confirm crossing 200 m",()=>{
    const initial=visit({company_time_in:"2026-09-29T00:01:00Z",status:"ON_SITE"});
    const uncertain=evaluateGeofences(initial,position(101.002,"2026-09-29T00:03:00Z",40),company,loading,30,200);
    expect(uncertain.patch.company_time_out).toBeUndefined();
    const precise=evaluateGeofences(initial,position(101.002,"2026-09-29T00:03:01Z"),company,loading,30,200);
    expect(precise.events).toContain("COMPANY_EXIT_CONFIRMED");
    expect(precise.patch.status).toBe("COMPLETED");
  });
  it("preserves a pending exit when the delayed warning runs",()=>{
    const pending=visit({company_time_in:"2026-09-29T00:01:00Z",exit_pending_at:"2026-09-29T00:03:00Z",status:"LEAVING"});
    expect(delayedStatus(pending,15,new Date("2026-09-29T02:00:00Z").getTime())).toBeNull();
  });
});
