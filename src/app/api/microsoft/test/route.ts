import { NextRequest, NextResponse } from "next/server";
import { actor, fail } from "@/lib/api";
import { adminClient } from "@/lib/supabase";
import { listDestinations, MicrosoftConnectionError, resolveSharedWorkbook, savedAccessToken, validateDestination, type ConnectionStatus } from "@/lib/microsoft-graph";

export async function POST(req: NextRequest) {
  try {
    await actor(req, ["admin"]);
    const { data: connection, error } = await adminClient().from("microsoft_connections")
      .select("share_url,drive_id,workbook_item_id,selected_target_kind,selected_target_id")
      .eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!connection?.share_url) return NextResponse.json({ status: "authentication_required", message: "Connect a Microsoft account first" });
    try {
      const token = await savedAccessToken();
      const workbook = await resolveSharedWorkbook(token, connection.share_url);
      if (workbook.driveId !== connection.drive_id || workbook.itemId !== connection.workbook_item_id) throw new MicrosoftConnectionError("workbook_inaccessible", "The sharing link now points to a different workbook");
      const destinations = await listDestinations(token, workbook);
      if (connection.selected_target_kind && connection.selected_target_id) {
        const target = destinations.find(item => item.kind === connection.selected_target_kind && item.id === connection.selected_target_id);
        if (!target) throw new MicrosoftConnectionError("workbook_inaccessible", "The selected worksheet or table was removed");
        await validateDestination(token, workbook, target);
      }
      return NextResponse.json({ status: "connected", workbook: { name: workbook.name, webUrl: workbook.webUrl }, destinations, destinationReady: Boolean(connection.selected_target_id) });
    } catch (caught) {
      const status: ConnectionStatus = caught instanceof MicrosoftConnectionError ? caught.code : "workbook_inaccessible";
      return NextResponse.json({ status, message: caught instanceof Error ? caught.message : String(caught) });
    }
  } catch (error) { return fail(error); }
}
