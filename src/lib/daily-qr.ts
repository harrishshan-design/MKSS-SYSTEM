import { adminClient } from "@/lib/supabase";
import { siteDate } from "@/lib/date";

export async function ensureDailyQr(createdBy?: string) {
  const db = adminClient();
  const date = siteDate();
  const { data: existing, error: existingError } = await db.from("attendance_qr")
    .select("*").eq("date", date).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: previous, error: previousError } = await db.from("attendance_qr")
    .select("site").order("date", { ascending: false }).limit(1).maybeSingle();
  if (previousError) throw previousError;
  let adminId = createdBy;
  if (!adminId) {
    const { data: admin, error: adminError } = await db.from("users")
      .select("id").eq("role", "admin").eq("active", true).limit(1).maybeSingle();
    if (adminError) throw adminError;
    if (!admin) throw new Error("Create an active administrator before generating the daily QR");
    adminId = admin.id;
  }

  const { data, error } = await db.from("attendance_qr")
    .insert({ date, site: previous?.site || "Main Gate", created_by: adminId })
    .select().single();
  if (error?.code === "23505") {
    const { data: winner, error: winnerError } = await db.from("attendance_qr")
      .select("*").eq("date", date).single();
    if (winnerError) throw winnerError;
    return winner;
  }
  if (error) throw error;
  return data;
}
