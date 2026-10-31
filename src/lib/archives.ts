import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { adminClient } from "./supabase";
import { ApiError } from "./api";
import { ARCHIVE_RESOURCES, archiveCsv, archiveXlsx, type ArchiveRow } from "./archive-format";

const bucket = "mkss-archives";
export const batchColumns = "id,archive_number,status,cutoff,started_at,exported_at,downloaded_at,confirmed_at,deleted_at,period_start,period_end,record_count,deleted_count,retained_count,stored_bytes,resource_counts,files_removed_at,table_index,bytes_before,bytes_after,error";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Chunk = { id: number; batch_id: string; resource: string; object_path: string; sha256: string; row_count: number; stored_bytes: number };
async function chunkData(chunk: Chunk) {
  const { data, error } = await adminClient().storage.from(bucket).download(chunk.object_path);
  if (error || !data) throw new ApiError(503, "Archive file is unavailable. No unverified records will be deleted.");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (hash(bytes) !== chunk.sha256) throw new ApiError(409, "Archive checksum failed. Cleanup stopped.");
  const rows = JSON.parse(gunzipSync(bytes).toString("utf8")) as ArchiveRow[];
  if (!Array.isArray(rows) || rows.length !== chunk.row_count) throw new ApiError(409, "Archive row count failed. Cleanup stopped.");
  return { bytes, rows };
}
export async function archiveStatus() {
  const db = adminClient();
  const { data: cached, error } = await db.from("database_health").select("*").eq("id", 1).single();
  if (error) throw error;
  // Capacity changes slowly. Avoid adding database-size calls to live polling.
  let health = cached;
  if (!cached.measured_at || Date.now() - Date.parse(cached.measured_at) > 240_000) {
    const refreshed = await db.rpc("refresh_database_health"); if (refreshed.error) throw refreshed.error; health = refreshed.data;
  }
  const [batches, drivers, vehicles, visits, oldest] = await Promise.all([
    db.from("archive_batches").select(batchColumns).neq("status", "CANCELLED").order("started_at", { ascending: false }).limit(1000),
    db.from("drivers").select("id", { count: "exact", head: true }), db.from("lorries").select("id", { count: "exact", head: true }),
    db.from("visits").select("id", { count: "exact", head: true }), db.from("visits").select("created_at").order("created_at").limit(1),
  ]);
  for (const result of [batches, drivers, vehicles, visits, oldest]) if (result.error) throw result.error;
  return { health, batches: batches.data || [], counts: { drivers: drivers.count || 0, vehicles: vehicles.count || 0, visits: visits.count || 0 }, oldest: oldest.data?.[0]?.created_at || null };
}
export async function processArchiveStep(batchId: string) {
  const db = adminClient(), token = randomUUID(), now = new Date().toISOString();
  const { data: b, error: leaseError } = await db.from("archive_batches").update({ lease_token: token, lease_until: new Date(Date.now() + 90_000).toISOString(), error: null })
    .eq("id", batchId).in("status", ["EXPORTING", "CLEANING"]).or(`lease_until.is.null,lease_until.lt.${now}`).select("*").maybeSingle();
  if (leaseError) throw leaseError;
  if (!b) return;
  try {
    if (b.status === "EXPORTING") {
      const resource = ARCHIVE_RESOURCES[b.table_index];
      if (!resource) {
        const result = await db.from("archive_batches").update({ status: "READY", exported_at: now }).eq("id", batchId).eq("lease_token", token);
        if (result.error) throw result.error; return;
      }
      const { data, error } = await db.rpc("archive_page", { p_batch: batchId, p_resource: resource, p_after: b.last_id });
      if (error) throw error;
      const rows = data as ArchiveRow[];
      if (!rows.length) {
        const result = await db.from("archive_batches").update({ table_index: b.table_index + 1, last_id: null }).eq("id", batchId).eq("lease_token", token);
        if (result.error) throw result.error; return;
      }
      const bytes = gzipSync(Buffer.from(JSON.stringify(rows))), checksum = hash(bytes);
      const objectPath = `${batchId}/${resource}/${b.last_id || "start"}-${checksum}.json.gz`;
      const { error: uploadError } = await db.storage.from(bucket).upload(objectPath, bytes, { contentType: "application/gzip", upsert: true });
      if (uploadError) throw new ApiError(503, "Could not store the archive. Check archive storage capacity and retry. Live records have not been deleted.");
      // Verify the stored object, not just a successful HTTP upload response.
      await chunkData({ id: 0, batch_id: batchId, resource, object_path: objectPath, sha256: checksum, row_count: rows.length, stored_bytes: bytes.length });
      const dates = rows.map(row => String(row.record.created_at || row.record.occurred_at || row.record.time_in || now)).sort();
      const committed = await db.rpc("archive_commit_chunk", { p_batch: batchId, p_token: token, p_last: rows.at(-1)!.record.id,
        p_chunk: { resource, object_path: objectPath, sha256: checksum, row_count: rows.length, first_at: dates[0], last_at: dates.at(-1), stored_bytes: bytes.length } });
      if (committed.error) throw committed.error;
    } else {
      // Export order places movement children before parent visits.
      const next = await db.from("archive_chunks").select("*").eq("batch_id", batchId).is("cleaned_at", null).order("id").limit(1);
      if (next.error) throw next.error;
      const chunk = next.data?.[0] as Chunk | undefined;
      if (!chunk) {
        const health = await db.rpc("refresh_database_health"); if (health.error) throw health.error;
        const done = await db.from("archive_batches").update({ status: "COMPLETED", deleted_at: new Date().toISOString(), bytes_after: health.data.measured_bytes }).eq("id", batchId).eq("lease_token", token);
        if (done.error) throw done.error; return;
      }
      const { rows } = await chunkData(chunk);
      const cleaned = await db.rpc("archive_clean_chunk", { p_chunk: chunk.id, p_rows: rows });
      if (cleaned.error) throw cleaned.error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Archive step failed. Retry to resume safely.";
    await db.from("archive_batches").update({ error: message }).eq("id", batchId).eq("lease_token", token);
    throw error;
  } finally {
    await db.from("archive_batches").update({ lease_token: null, lease_until: null }).eq("id", batchId).eq("lease_token", token);
  }
}

export async function* downloadArchive(batchId: string) {
  const db = adminClient();
  const batch = await db.from("archive_batches").select(batchColumns).eq("id", batchId).single();
  if (batch.error || !batch.data || !["READY", "CLEANING", "COMPLETED"].includes(batch.data.status)) throw new ApiError(409, "Archive export has not finished");
  if (batch.data.files_removed_at) throw new ApiError(410, "The online copy was removed by an administrator. Use the saved archive copies.");
  const queue: Uint8Array[] = []; let zipError: Error | null = null;
  const zip = new Zip((error, bytes) => { if (error) zipError = error; else if (bytes) queue.push(bytes); });
  const add = (name: string, data: Uint8Array, compress = false) => { const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name); zip.add(entry); entry.push(data, true); };
  add("README.txt", strToU8("MKSS operational archive\r\nXLSX and CSV files are numbered parts with at most 500 records each. Combine all parts for a complete resource. Dates in reports use Malaysia time. Raw gzip JSON files preserve original fields, UUIDs, timestamps and row fingerprints. Master data is retained in MKSS; names/company/vehicle context is included with attendance and visits. Open/today/unverified trips are excluded. Keep this entire ZIP in two safe places before confirming cleanup.\r\n"), true);
  while (queue.length) yield queue.shift()!;
  let cursor = 0, total = 0;
  for (;;) {
    const page = await db.from("archive_chunks").select("*").eq("batch_id", batchId).gt("id", cursor).order("id").limit(100);
    if (page.error) throw page.error;
    if (!page.data?.length) break;
    for (const chunk of page.data as Chunk[]) {
      const { bytes, rows } = await chunkData(chunk);
      const base = `${chunk.resource}/part_${String(chunk.id).padStart(6, "0")}`;
      add(`${base}.csv`, strToU8(archiveCsv(rows)), true);
      add(`${base}.xlsx`, archiveXlsx(rows));
      add(`raw/${base}.json.gz`, bytes);
      total += rows.length; cursor = chunk.id;
      while (queue.length) yield queue.shift()!;
      if (zipError) throw zipError;
    }
  }
  if (total !== batch.data.record_count) throw new ApiError(409, "Archive total does not match the manifest");
  add("manifest.json", strToU8(JSON.stringify({ ...batch.data, exported_rows: total, schema_version: 1 }, null, 2)), true);
  zip.end();
  while (queue.length) yield queue.shift()!;
  if (zipError) throw zipError;
  const marked = await db.from("archive_batches").update({ downloaded_at: new Date().toISOString() }).eq("id", batchId);
  if (marked.error) throw marked.error;
}
