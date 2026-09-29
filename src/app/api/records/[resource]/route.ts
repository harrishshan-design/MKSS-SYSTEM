import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actor, ApiError, audit, fail, json } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

const schemas = {
  companies: z.object({ name:z.string().min(2), contact_person:z.string().optional().nullable(), phone:z.string().optional().nullable(), email:z.email().optional().nullable(), active:z.boolean().optional() }),
  drivers: z.object({ full_name:z.string().min(2), identity_reference:z.string().optional().nullable(), phone:z.string().min(5), licence_number:z.string().optional().nullable(), company_id:z.uuid(), active:z.boolean().optional(), qr_active:z.boolean().optional() }),
  lorries: z.object({ registration_number:z.string().min(3), company_id:z.uuid(), vehicle_type:z.string().min(2), assigned_driver_id:z.uuid().optional().nullable(), active:z.boolean().optional() }),
  security_guards: z.object({ full_name:z.string().min(2), phone:z.string().optional().nullable(), shift:z.string().optional().nullable(), site:z.string().optional().nullable(), active:z.boolean().optional() })
};
type Resource = keyof typeof schemas;
function resource(value: string): Resource { if (!(value in schemas)) throw new ApiError(404,"Unknown resource"); return value as Resource; }
export async function GET(req: NextRequest, context: { params: Promise<{resource:string}> }) {
  try { await actor(req,["admin"]); const table = resource((await context.params).resource); const { data,error } = await adminClient().from(table).select("*").order("created_at",{ascending:false}).limit(500); if(error) throw error; return NextResponse.json(data); }
  catch(error) { return fail(error); }
}
export async function POST(req: NextRequest, context: { params: Promise<{resource:string}> }) {
  try {
    const who=await actor(req,["admin"]); const table=resource((await context.params).resource);
    const input=schemas[table].parse(await json(req));
    const {data,error}=await adminClient().from(table).insert(input as Record<string, unknown>).select().single(); if(error) throw error;
    await audit(who,`${table.toUpperCase()}_CREATED`,table,data.id,null,data);
    return NextResponse.json(data,{status:201});
  } catch(error) { return fail(error); }
}
export async function PATCH(req: NextRequest, context: { params: Promise<{resource:string}> }) {
  try {
    const who=await actor(req,["admin"]); const table=resource((await context.params).resource);
    const body=await json(req); const id=z.uuid().parse(body.id); const {data:old,error:readError}=await adminClient().from(table).select("*").eq("id",id).single(); if(readError) throw readError;
    const changes=schemas[table].partial().parse(body);
    const {data,error}=await adminClient().from(table).update(changes).eq("id",id).select().single(); if(error) throw error;
    await audit(who,`${table.toUpperCase()}_UPDATED`,table,id,old,data);
    return NextResponse.json(data);
  } catch(error) { return fail(error); }
}
export async function DELETE(req: NextRequest, context: { params: Promise<{resource:string}> }) {
  try {
    const who=await actor(req,["admin"]); const table=resource((await context.params).resource); const id=z.uuid().parse((await json(req)).id);
    const {data:old,error:readError}=await adminClient().from(table).select("*").eq("id",id).single(); if(readError) throw readError;
    const {error}=await adminClient().from(table).update({active:false}).eq("id",id); if(error) throw error;
    await audit(who,`${table.toUpperCase()}_DEACTIVATED`,table,id,old,{active:false});
    return NextResponse.json({ok:true});
  } catch(error) { return fail(error); }
}
