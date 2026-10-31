import { strToU8, zipSync } from "fflate";

export type ArchiveRow = { record: Record<string, unknown>; hash: string; context: Record<string, unknown> | null };
export const ARCHIVE_RESOURCES = ["geofence_events", "audit_logs", "security_attendance", "contractor_attendance", "admin_push_deliveries", "excel_sync_queue", "visits"] as const;
export function storageBand(percent: number) { return percent >= 94 ? 94 : percent >= 92 ? 92 : percent >= 90 ? 90 : 0; }
export function snoozeHours(percent: number) { const band = storageBand(percent); return band === 94 ? 0 : band === 92 ? 6 : band === 90 ? 24 : 0; }
export function exportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:/.test(text) && !Number.isNaN(Date.parse(text))) {
    const date = new Date(text);
    return `${date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })} ${date.toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()} MYT`;
  }
  return text;
}
export function archiveGrid(rows: ArchiveRow[]) {
  const objects = rows.map(row => ({ ...row.record, ...Object.fromEntries(Object.entries(row.context || {}).map(([k, v]) => [`context_${k}`, v])) }));
  const headers = [...new Set(objects.flatMap(Object.keys))];
  return [headers, ...objects.map(row => headers.map(header => exportValue(row[header])))];
}
export function archiveCsv(rows: ArchiveRow[]) {
  return "\uFEFF" + archiveGrid(rows).map(row => row.map(value => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function column(index: number): string { let value = index + 1, result = ""; while (value) { result = String.fromCharCode(65 + (value - 1) % 26) + result; value = Math.floor((value - 1) / 26); } return result; }
// A bounded workbook part (at most 500 records). Every cell is literal text:
// identifiers keep leading zeros and untrusted values can never become formulas.
export function archiveXlsx(rows: ArchiveRow[]) {
  const grid = archiveGrid(rows), width = grid[0].length;
  const entries: Record<string, Uint8Array> = {};
  const put = (name: string, value: string) => { entries[name] = strToU8(value); };
  put("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  put("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  put("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>');
  put("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  put("xl/styles.xml", '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183C3A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs></styleSheet>');
  put("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + grid[0].map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="26" customWidth="1"/>`).join("") + '</cols><sheetData>' + grid.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${column(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("") + `</sheetData><autoFilter ref="A1:${column(Math.max(width - 1, 0))}${grid.length}"/></worksheet>`);
  return zipSync(entries, { level: 6 });
}
