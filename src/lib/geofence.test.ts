import { describe, expect, it } from "vitest";
import { evaluateGeofences, insideFence, metersBetween } from "./geofence";
import type { Fence, Position, Visit } from "./types";
const company:Fence={id:"site",kind:"company",name:"Site",latitude:3.0,longitude:101.0,radius_meters:300,enabled:true};
const loading:Fence={id:"zone",kind:"loading",name:"Loading",latitude:3.0,longitude:101.0,radius_meters:70,enabled:true};
const position=(longitude:number,time:string):Position=>({latitude:3,longitude,accuracy:5,timestamp:time,deviceId:"test"});
const visit=(changes:Partial<Visit>={}):Visit=>({id:"v",visit_code:"VIS-1",driver_id:"d",lorry_id:"l",company_id:"c",guard_id:"g",visit_date:"2026-09-29",purpose:null,security_registered_at:"2026-09-29T00:00:00Z",company_time_in:null,loading_area_in:null,loading_area_out:null,company_time_out:null,loading_duration_seconds:null,total_duration_seconds:null,status:"REGISTERED",exit_pending_at:null,latitude_last:null,longitude_last:null,last_location_at:null,last_observed_at:null,created_at:"2026-09-29T00:00:00Z",updated_at:"2026-09-29T00:00:00Z",...changes});
describe("geofence transitions",()=>{
  it("respects GPS uncertainty at the edge",()=>{const edge=position(101+300/111000,"2026-09-29T00:00:00Z");expect(insideFence(edge,company).inside).toBe(false);expect(metersBetween(company,edge)).toBeGreaterThan(290);});
  it("records company and loading entry",()=>{const result=evaluateGeofences(visit(),position(101,"2026-09-29T00:01:00Z"),company,loading,120);expect(result.events).toEqual(["COMPANY_ENTER","LOADING_ZONE_ENTER"]);expect(result.patch.status).toBe("LOADING_UNLOADING");});
  it("requires exit confirmation and cancels a false exit",()=>{const initial=visit({company_time_in:"2026-09-29T00:01:00Z",status:"ON_SITE"});const pending=evaluateGeofences(initial,position(101.004,"2026-09-29T00:04:00Z"),company,loading,120);expect(pending.events).toEqual(["COMPANY_EXIT_PENDING"]);expect(pending.patch.company_time_out).toBeUndefined();const returned=evaluateGeofences({...initial,exit_pending_at:"2026-09-29T00:04:00Z"},position(101.002,"2026-09-29T00:05:00Z"),company,loading,120);expect(returned.events).toContain("COMPANY_EXIT_CANCELLED");expect(returned.patch.company_time_out).toBeUndefined();});
  it("completes only after a second outside reading past the interval",()=>{const initial=visit({company_time_in:"2026-09-29T00:01:00Z",exit_pending_at:"2026-09-29T00:04:00Z",status:"LEAVING"});const early=evaluateGeofences(initial,position(101.004,"2026-09-29T00:05:59Z"),company,loading,120);expect(early.patch.status).toBeUndefined();const done=evaluateGeofences(initial,position(101.004,"2026-09-29T00:06:00Z"),company,loading,120);expect(done.events).toContain("COMPANY_EXIT_CONFIRMED");expect(done.patch.status).toBe("COMPLETED");expect(done.patch.total_duration_seconds).toBe(300);});
  it("marks departure at the site but checks out only beyond 5 km",()=>{
    const initial=visit({company_time_in:"2026-09-29T00:01:00Z",status:"ON_SITE"});
    const leaving=evaluateGeofences(initial,position(101.004,"2026-09-29T00:04:00Z"),company,loading,120,5000);
    expect(leaving.patch.status).toBe("LEAVING");
    expect(leaving.patch.company_time_out).toBeUndefined();
    const pending=visit({...initial,exit_pending_at:"2026-09-29T00:04:00Z",status:"LEAVING"});
    const near=evaluateGeofences(pending,position(101.02,"2026-09-29T00:07:00Z"),company,loading,120,5000);
    expect(near.patch.company_time_out).toBeUndefined();
    const far=evaluateGeofences(pending,position(101.06,"2026-09-29T00:08:00Z"),company,loading,120,5000);
    expect(far.events).toContain("COMPANY_EXIT_CONFIRMED");
    expect(far.patch.status).toBe("COMPLETED");
  });
});
