import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const { data, count, error } = await adminClient()
      .from("driver_registration_requests")
      .select("id,full_name,requested_lorry,created_at", { count: "exact" })
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    return NextResponse.json(
      { count: count ?? 0, requests: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) { return fail(error); }
}
