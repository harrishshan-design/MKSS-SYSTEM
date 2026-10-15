import type { SupabaseClient } from "@supabase/supabase-js";

export type ReportVisit = {
  id: string;
  company_id: string;
  guard_id: string | null;
  status: string;
  registration_source: string;
  loading_duration_seconds: number | null;
  total_duration_seconds: number | null;
  checkout_method: string | null;
  companies: { name: string } | null;
  security_guards: { full_name: string } | null;
};

export function summarizeVisits(visits: ReportVisit[]) {
  const companies = new Map<string, { id: string; name: string; count: number }>();
  const registrars = new Map<string, { id: string; name: string; count: number }>();
  for (const visit of visits) {
    const company = companies.get(visit.company_id) || {
      id: visit.company_id, name: visit.companies?.name || "Company unavailable", count: 0,
    };
    company.count++;
    companies.set(company.id, company);
    const registrarId = visit.guard_id || (visit.registration_source === "DRIVER_DAILY_QR" ? "driver-qr" : "unassigned");
    const registrar = registrars.get(registrarId) || {
      id: registrarId,
      name: visit.security_guards?.full_name || (registrarId === "driver-qr" ? "Driver QR check-in" : "Unassigned registration"),
      count: 0,
    };
    registrar.count++;
    registrars.set(registrar.id, registrar);
  }
  const completed = visits.filter(visit => visit.status === "COMPLETED");
  const loading = completed.map(visit => visit.loading_duration_seconds)
    .filter((seconds): seconds is number => seconds !== null && Number.isFinite(seconds) && seconds >= 0);
  const durations = completed.map(visit => visit.total_duration_seconds)
    .filter((seconds): seconds is number => seconds !== null && Number.isFinite(seconds) && seconds >= 0);
  const byCount = (a: { name: string; count: number }, b: { name: string; count: number }) =>
    b.count - a.count || a.name.localeCompare(b.name);
  return {
    totalVisits: visits.length,
    completedVisits: completed.length,
    cancelledVisits: visits.filter(visit => visit.status === "CANCELLED").length,
    unverifiedTimeouts: completed.filter(visit => visit.checkout_method === "TIME_LIMIT").length,
    averageLoadingSeconds: loading.length ? loading.reduce((sum, seconds) => sum + seconds, 0) / loading.length : null,
    loadingSampleCount: loading.length,
    longestVisitSeconds: durations.length ? Math.max(...durations) : null,
    byCompany: [...companies.values()].sort(byCount),
    byRegistrar: [...registrars.values()].sort(byCount),
  };
}

export type DailyReport = ReturnType<typeof summarizeVisits> & { date: string; asOf: string };

export async function loadDailyReport(db: SupabaseClient, date: string, asOf = new Date().toISOString()): Promise<DailyReport> {
  const visits: ReportVisit[] = [];
  const pageSize = 500;
  let expected: number | null = null;
  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await db.from("visits")
      .select("id,company_id,guard_id,status,registration_source,loading_duration_seconds,total_duration_seconds,checkout_method,companies(name),security_guards(full_name)", { count: "exact" })
      .eq("visit_date", date).lte("created_at", asOf)
      .order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load the report: ${error.message}`);
    if (count === null) throw new Error("Report count is unavailable. Please refresh.");
    if (expected === null) expected = count;
    if (count !== expected) throw new Error("Visit records changed while the report was loading. Please refresh.");
    if (expected > 50_000) throw new Error("Today's report exceeds 50,000 visits. Contact the administrator.");
    const page = (data || []) as unknown as ReportVisit[];
    visits.push(...page);
    if (visits.length >= expected) break;
    if (page.length === 0) throw new Error("The report is incomplete. Please refresh.");
  }
  if (visits.length !== expected || new Set(visits.map(visit => visit.id)).size !== expected)
    throw new Error("The report is incomplete. Please refresh.");
  return { date, asOf, ...summarizeVisits(visits) };
}
