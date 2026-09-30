import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const { data, error } = await adminClient().from("driver_registration_requests")
      .select("id,email,full_name,phone,licence_number,requested_company,requested_lorry,status,created_at")
      .eq("status", "PENDING").order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return fail(error); }
}
