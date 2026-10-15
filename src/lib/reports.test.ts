import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDailyReport, summarizeVisits, type ReportVisit } from "./reports";

function visit(id: string, changes: Partial<ReportVisit> = {}): ReportVisit {
  return {
    id, company_id: "company-1", guard_id: null, status: "COMPLETED",
    registration_source: "DRIVER_DAILY_QR", loading_duration_seconds: null,
    total_duration_seconds: null, checkout_method: "GATE",
    companies: { name: "Transport company" }, security_guards: null, ...changes,
  };
}

function mockDatabase(rows: ReportVisit[]) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: rows.length, error: null })),
  };
  return { query, db: { from: vi.fn(() => query) } as unknown as SupabaseClient };
}

describe("company visit reports", () => {
  it("counts repeat trips and keeps different company IDs distinct even if names match", () => {
    const report = summarizeVisits([visit("trip-1"), visit("trip-2"), visit("trip-3", { company_id: "company-2" })]);
    expect(report.totalVisits).toBe(3);
    expect(report.byCompany.map(company => company.count)).toEqual([2, 1]);
    expect(report.byCompany.reduce((sum, company) => sum + company.count, 0)).toBe(report.totalVisits);
    expect(report.byRegistrar).toEqual([{ id: "driver-qr", name: "Driver QR check-in", count: 3 }]);
  });

  it("does not replace missing recorded durations with invented zero values", () => {
    const report = summarizeVisits([
      visit("one", { loading_duration_seconds: 600, total_duration_seconds: 900 }),
      visit("two", { checkout_method: "TIME_LIMIT" }),
      visit("three", { status: "CANCELLED" }),
    ]);
    expect(report.averageLoadingSeconds).toBe(600);
    expect(report.loadingSampleCount).toBe(1);
    expect(report.longestVisitSeconds).toBe(900);
    expect(report.cancelledVisits).toBe(1);
    expect(report.unverifiedTimeouts).toBe(1);
    expect(summarizeVisits([visit("missing")]).averageLoadingSeconds).toBeNull();
    expect(summarizeVisits([]).longestVisitSeconds).toBeNull();
  });

  it("reads every page beyond 500 visits and includes more than eight companies", async () => {
    const rows = Array.from({ length: 527 }, (_, index) => visit(`visit-${index}`, {
      company_id: `company-${index % 11}`, companies: { name: `Company ${index % 11}` },
    }));
    const { db, query } = mockDatabase(rows);
    const report = await loadDailyReport(db, "2026-10-15", "2026-10-15T12:00:00.000Z");
    expect(query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(query.eq).toHaveBeenCalledWith("visit_date", "2026-10-15");
    expect(report.totalVisits).toBe(527);
    expect(report.byCompany).toHaveLength(11);
    expect(report.byCompany.reduce((sum, company) => sum + company.count, 0)).toBe(527);
  });

  it("rejects incomplete results instead of displaying a partial total", async () => {
    const { db, query } = mockDatabase([visit("one")]);
    query.range.mockResolvedValue({ data: [], count: 1, error: null });
    await expect(loadDailyReport(db, "2026-10-15")).rejects.toThrow("incomplete");
  });
});
