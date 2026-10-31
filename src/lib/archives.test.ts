import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";
import { downloadArchive } from "./archives";

const db = vi.hoisted(() => ({ from: vi.fn(), download: vi.fn(), marked: vi.fn(), chunkPage: vi.fn() }));
vi.mock("./supabase", () => ({ adminClient: () => ({ from: db.from, storage: { from: () => ({ download: db.download }) } }), publicClient: vi.fn() }));
const batchId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  const rows = [{ record: { id: "original-id", created_at: "2026-01-01T01:00:00Z" }, hash: "original-row-hash", context: { driver: "Test driver" } }];
  const bytes = gzipSync(Buffer.from(JSON.stringify(rows)));
  db.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  db.chunkPage.mockResolvedValueOnce({ data: [{ id: 1, batch_id: batchId, resource: "visits", object_path: "private-part", row_count: 1, sha256: createHash("sha256").update(bytes).digest("hex") }], error: null }).mockResolvedValue({ data: [], error: null });
  db.marked.mockResolvedValue({ error: null });
  db.from.mockImplementation(table => table === "archive_batches" ? {
    select: () => ({ eq: () => ({ single: async () => ({ data: { id: batchId, status: "READY", record_count: 1 }, error: null }) }) }),
    update: () => ({ eq: db.marked }),
  } : { select: () => ({ eq: () => ({ gt: () => ({ order: () => ({ limit: db.chunkPage }) }) }) }) });
});
describe("complete verified archive downloads", () => {
  it("includes matching XLSX, CSV and original JSON before enabling confirmation", async () => {
    const chunks: Uint8Array[] = [];
    for await (const bytes of downloadArchive(batchId)) chunks.push(bytes);
    const files = unzipSync(Buffer.concat(chunks));
    expect(strFromU8(files["manifest.json"])).toContain('"exported_rows": 1');
    expect(strFromU8(files["visits/part_000001.csv"])).toContain("Test driver");
    expect(unzipSync(files["visits/part_000001.xlsx"])["xl/worksheets/sheet1.xml"]).toBeDefined();
    expect(files["raw/visits/part_000001.json.gz"]).toBeDefined();
    expect(db.marked).toHaveBeenCalledOnce();
  });
  it("never marks interrupted or checksum-failed downloads as complete", async () => {
    const interrupted = downloadArchive(batchId); await interrupted.next(); await interrupted.return(undefined);
    expect(db.marked).not.toHaveBeenCalled();
    db.download.mockResolvedValue({ data: new Blob(["corrupted archive"]), error: null });
    const consume = async () => { for await (const bytes of downloadArchive(batchId)) void bytes; };
    await expect(consume()).rejects.toThrow("checksum failed");
    expect(db.marked).not.toHaveBeenCalled();
  });
  it("does not offer downloads after an administrator removed the online copy", async () => {
    db.from.mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: batchId, status: "COMPLETED", files_removed_at: "2026-01-01T00:00:00Z" }, error: null }) }) }) }));
    await expect(downloadArchive(batchId).next()).rejects.toThrow("online copy was removed");
    expect(db.download).not.toHaveBeenCalled();
  });
});
