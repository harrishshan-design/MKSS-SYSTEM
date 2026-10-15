import { NextRequest, NextResponse } from "next/server";
import { actor, ApiError, fail } from "@/lib/api";
import { csvDocument, csvMalaysiaDateTime } from "@/lib/csv";
import { adminClient } from "@/lib/supabase";

type Resource = "visits" | "drivers" | "lorries" | "companies";
type Row = Record<string, unknown>;
const pageSize = 500;
const maxRows = 50_000;
const resources: Resource[] = ["visits", "drivers", "lorries", "companies"];
const selects: Record<Resource, string> = {
  visits: "*,drivers(full_name),lorries(registration_number,vehicle_type),companies(name),security_guards(full_name)",
  drivers: "id,driver_code,full_name,identity_reference,phone,licence_number,default_trip_type,active,created_at,companies(name)",
  lorries: "id,lorry_code,registration_number,vehicle_type,active,created_at,companies(name),drivers(full_name)",
  companies: "id,company_code,name,contact_person,phone,email,active,created_at",
};

function related(row: Row, key: string, field: string): unknown {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row)[field] : "";
}

function document(resource: Resource, rows: Row[]): string {
  if (resource === "visits") return csvDocument(
    ["Visit ID", "Date", "Driver", "Company", "Vehicle number", "Vehicle type", "Guard", "Trip type", "Status", "Registered (MYT)", "Time in (MYT)", "Loading in (MYT)", "Loading out (MYT)", "Recorded time out / timer (MYT)", "Exit verified at (MYT)", "Total seconds", "Exit method"],
    rows.map(row => [row.visit_code, row.visit_date, related(row, "drivers", "full_name"), related(row, "companies", "name"), related(row, "lorries", "registration_number"), related(row, "lorries", "vehicle_type"), related(row, "security_guards", "full_name"), row.purpose, row.status, csvMalaysiaDateTime(row.security_registered_at), csvMalaysiaDateTime(row.company_time_in), csvMalaysiaDateTime(row.loading_area_in), csvMalaysiaDateTime(row.loading_area_out), csvMalaysiaDateTime(row.company_time_out), csvMalaysiaDateTime(row.exit_verified_at), row.total_duration_seconds, row.checkout_method === "TIME_LIMIT_VERIFIED" ? "Timer ended · physical exit verified" : row.checkout_method === "TIME_LIMIT" ? "Timer ended · exit unverified" : row.checkout_method === "GATE" ? "Gate scan" : row.checkout_method === "ADMIN" ? "Admin correction" : row.checkout_method]),
  );
  if (resource === "drivers") return csvDocument(
    ["Driver ID", "Driver code", "Name", "IC number", "Phone", "Driving licence", "Company", "Trip type", "Active", "Created at (MYT)"],
    rows.map(row => [row.id, row.driver_code, row.full_name, row.identity_reference, row.phone, row.licence_number, related(row, "companies", "name"), row.default_trip_type, row.active, csvMalaysiaDateTime(row.created_at)]),
  );
  if (resource === "lorries") return csvDocument(
    ["Lorry ID", "Lorry code", "Vehicle number", "Vehicle type", "Company", "Assigned driver", "Active", "Created at (MYT)"],
    rows.map(row => [row.id, row.lorry_code, row.registration_number, row.vehicle_type, related(row, "companies", "name"), related(row, "drivers", "full_name"), row.active, csvMalaysiaDateTime(row.created_at)]),
  );
  return csvDocument(
    ["Company ID", "Company code", "Company name", "Contact", "Phone", "Email", "Active", "Created at (MYT)"],
    rows.map(row => [row.id, row.company_code, row.name, row.contact_person, row.phone, row.email, row.active, csvMalaysiaDateTime(row.created_at)]),
  );
}

export async function GET(req: NextRequest, context: { params: Promise<{ resource: string }> }) {
  try {
    const resource = (await context.params).resource;
    if (!resources.includes(resource as Resource)) throw new ApiError(404, "Unknown export");
    const selected = resource as Resource;
    await actor(req, selected === "visits" ? ["admin", "monitor"] : ["admin"]);
    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    if (selected === "visits" && ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)))
      throw new ApiError(400, "Choose a valid date range");
    const cutoff = new Date().toISOString();
    const rows: Row[] = [];
    for (let start = 0; start < maxRows; start += pageSize) {
      let query = adminClient().from(selected).select(selects[selected])
        .lte("created_at", cutoff).order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(start, start + pageSize - 1);
      if (selected === "visits" && from) query = query.gte("visit_date", from);
      if (selected === "visits" && to) query = query.lte("visit_date", to);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []) as unknown as Row[]);
      if ((data?.length || 0) < pageSize) break;
    }
    if (rows.length >= maxRows) throw new ApiError(413, "Export exceeds 50,000 records. Choose a shorter date range.");
    const filename = selected === "visits" ? `mkss-visits-${from || "all"}-to-${to || "all"}.csv` : `mkss-${selected}.csv`;
    return new NextResponse(document(selected, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) { return fail(error); }
}
