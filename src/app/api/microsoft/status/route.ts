import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { listDestinations, microsoftSetup, savedAccessToken, validateDestination, MicrosoftConnectionError, type ConnectionStatus, type Destination } from "@/lib/microsoft-graph";

export async function GET(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const db = adminClient();
    const [connection, queue] = await Promise.all([
      db.from("microsoft_connections").select("connected_at,workbook_name,workbook_web_url,drive_id,workbook_item_id,selected_target_kind,selected_target_id,selected_target_name").eq("id", 1).maybeSingle(),
      db.from("excel_sync_queue").select("id,entity_type,sync_status,sync_attempts,last_sync_error,last_sync_time,created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    const setup = microsoftSetup(req.nextUrl.origin);
    if (connection.error?.code === "42703" || connection.error?.code === "PGRST205") {
      setup.ready = false;
      setup.issues.push("Apply the Microsoft spreadsheet connection migration to Supabase");
      return NextResponse.json({ setup, status: "authentication_required", connection: null, destinations: [], connectionError: null, queue: queue.data || [] });
    }
    if (connection.error || queue.error) throw connection.error || queue.error;
    let status: ConnectionStatus = "authentication_required";
    let connectionError: string | null = null;
    let destinations: Destination[] = [];
    const saved = connection.data;
    if (setup.ready && saved?.drive_id && saved.workbook_item_id) {
      try {
        const token = await savedAccessToken();
        const workbook = { driveId: saved.drive_id, itemId: saved.workbook_item_id, name: saved.workbook_name || "Excel workbook", webUrl: saved.workbook_web_url };
        destinations = await listDestinations(token, workbook);
        if (saved.selected_target_kind && saved.selected_target_id) {
          const target = destinations.find(item => item.kind === saved.selected_target_kind && item.id === saved.selected_target_id);
          if (!target) throw new MicrosoftConnectionError("workbook_inaccessible", "The selected worksheet or table was removed");
          await validateDestination(token, workbook, target);
        }
        status = "connected";
      } catch (error) {
        status = error instanceof MicrosoftConnectionError ? error.code : "workbook_inaccessible";
        connectionError = error instanceof Error ? error.message : String(error);
      }
    }
    const publicConnection = saved ? {
      connected_at: saved.connected_at,
      workbook_name: saved.workbook_name,
      workbook_web_url: saved.workbook_web_url,
      selected_target_kind: saved.selected_target_kind,
      selected_target_id: saved.selected_target_id,
      selected_target_name: saved.selected_target_name,
    } : null;
    return NextResponse.json({ setup, status, connection: publicConnection, destinations, connectionError, queue: queue.data });
  } catch (error) { return fail(error); }
}
