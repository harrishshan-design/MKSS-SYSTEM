import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { adminClient } from "./supabase";

export type ConnectionStatus = "connected" | "authentication_required" | "workbook_inaccessible" | "permission_denied" | "invalid_spreadsheet_link";
export type Destination = { id: string; name: string; kind: "worksheet" | "table"; worksheetId?: string; worksheetName?: string };
export type Workbook = { driveId: string; itemId: string; name: string; webUrl: string | null };
export const mkssHeaders = ["MKSS Key", "Record Type", "Record Code", "Name", "Status", "Timestamp", "Details", "Updated At"];

export class MicrosoftConnectionError extends Error {
  constructor(public code: Exclude<ConnectionStatus, "connected">, message: string, public httpStatus?: number) { super(message); }
}

const requiredVariables = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TOKEN_ENCRYPTION_KEY", "APP_URL"] as const;
export function microsoftSetup(currentOrigin?: string) {
  const missing = requiredVariables.filter(name => !process.env[name]?.trim());
  const issues: string[] = [];
  const rawKey = process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY;
  if (rawKey && Buffer.from(rawKey, "base64").length !== 32) issues.push("MICROSOFT_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) issues.push("APP_URL must be the application origin");
      if (currentOrigin && url.origin !== currentOrigin) issues.push("APP_URL must match the address used to open MKSS SYSTEM");
    } catch { issues.push("APP_URL must be a valid URL"); }
  }
  return { ready: missing.length === 0 && issues.length === 0, missing, issues };
}

export function microsoftConfig() {
  const setup = microsoftSetup();
  if (!setup.ready) throw new Error(`Microsoft setup incomplete: ${[...setup.missing, ...setup.issues].join(", ")}`);
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    appUrl: new URL(process.env.APP_URL!).origin,
  };
}

function encryptionKey() { return Buffer.from(process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY!, "base64"); }
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

export function validateSpreadsheetLink(input: string) {
  const value = input.trim();
  if (value.length > 4096) throw new MicrosoftConnectionError("invalid_spreadsheet_link", "The spreadsheet link is too long");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error("Invalid URL");
    return value;
  } catch { throw new MicrosoftConnectionError("invalid_spreadsheet_link", "Paste an HTTPS sharing link from Excel Online, OneDrive, or SharePoint"); }
}
export function shareToken(url: string) { return `u!${Buffer.from(url, "utf8").toString("base64url")}`; }
export function stateHash(state: string) { return createHash("sha256").update(state).digest("hex"); }
export function createOAuthSecrets() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

async function tokenRequest(body: URLSearchParams) {
  let response: Response;
  try { response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", { method: "POST", body }); }
  catch { throw new MicrosoftConnectionError("authentication_required", "Microsoft sign-in could not be reached"); }
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new MicrosoftConnectionError("authentication_required", data.error_description || "Microsoft authentication is required");
  return data;
}

export async function exchangeCode(code: string, verifier: string) {
  const config = microsoftConfig();
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${config.appUrl}/api/microsoft/callback`, scope: "offline_access Files.ReadWrite User.Read" });
  const data = await tokenRequest(body);
  if (!data.refresh_token) throw new MicrosoftConnectionError("authentication_required", "Microsoft did not provide offline access");
  return { accessToken: String(data.access_token), refreshToken: String(data.refresh_token) };
}

export async function savedAccessToken() {
  const config = microsoftConfig();
  const db = adminClient();
  const { data, error } = await db.from("microsoft_connections").select("encrypted_refresh_token").eq("id", 1).maybeSingle();
  if (error || !data) throw new MicrosoftConnectionError("authentication_required", "Connect a Microsoft account first");
  let refreshToken: string;
  try { refreshToken = decrypt(data.encrypted_refresh_token); }
  catch { throw new MicrosoftConnectionError("authentication_required", "Microsoft credentials could not be read. Reconnect the account."); }
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline_access Files.ReadWrite User.Read" });
  const token = await tokenRequest(body);
  if (token.refresh_token) {
    const { error: saveError } = await db.from("microsoft_connections").update({ encrypted_refresh_token: encrypt(String(token.refresh_token)), updated_at: new Date().toISOString() }).eq("id", 1);
    if (saveError) throw saveError;
  }
  return String(token.access_token);
}

export async function graph(token: string, path: string, method = "GET", body?: unknown, extraHeaders?: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new MicrosoftConnectionError("workbook_inaccessible", "Microsoft Graph could not be reached"); }
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const code = response.status === 401 ? "authentication_required" : response.status === 403 ? "permission_denied" : "workbook_inaccessible";
    throw new MicrosoftConnectionError(code, data.error?.message || `Microsoft Graph returned ${response.status}`, response.status);
  }
  return data;
}

export async function resolveSharedWorkbook(token: string, sharingUrl: string): Promise<Workbook> {
  const url = validateSpreadsheetLink(sharingUrl);
  let item: any;
  try { item = await graph(token, `/shares/${shareToken(url)}/driveItem`, "GET", undefined, { Prefer: "redeemSharingLink", "Content-Type": "application/json" }); }
  catch (error) {
    if (error instanceof MicrosoftConnectionError && [400, 404].includes(error.httpStatus || 0)) throw new MicrosoftConnectionError("invalid_spreadsheet_link", "Microsoft could not resolve this spreadsheet sharing link", error.httpStatus);
    throw error;
  }
  const actual = item.remoteItem || item;
  const driveId = actual.parentReference?.driveId || item.parentReference?.driveId;
  const itemId = actual.id;
  if (!driveId || !itemId || !actual.file) throw new MicrosoftConnectionError("invalid_spreadsheet_link", "The link does not point to an Excel file");
  return { driveId: String(driveId), itemId: String(itemId), name: String(actual.name || item.name || "Excel workbook"), webUrl: typeof actual.webUrl === "string" ? actual.webUrl : typeof item.webUrl === "string" ? item.webUrl : null };
}

export function workbookRoot(workbook: Pick<Workbook, "driveId" | "itemId">) {
  return `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`;
}

export async function listDestinations(token: string, workbook: Workbook): Promise<Destination[]> {
  const root = workbookRoot(workbook);
  const sheets = await graph(token, `${root}/worksheets`);
  if (!Array.isArray(sheets.value) || sheets.value.length === 0) throw new MicrosoftConnectionError("workbook_inaccessible", "This file has no accessible worksheets");
  const worksheets: Destination[] = sheets.value.map((sheet: any) => ({ id: String(sheet.id), name: String(sheet.name), kind: "worksheet" }));
  const tableGroups = await Promise.all(worksheets.map(async sheet => {
    const result = await graph(token, `${root}/worksheets/${encodeURIComponent(sheet.id)}/tables`);
    return (result.value || []).map((table: any): Destination => ({ id: String(table.id), name: String(table.name), kind: "table", worksheetId: sheet.id, worksheetName: sheet.name }));
  }));
  return [...worksheets, ...tableGroups.flat()];
}

export async function validateDestination(token: string, workbook: Workbook, destination: Pick<Destination, "kind" | "id">) {
  const root = workbookRoot(workbook);
  if (destination.kind === "worksheet") {
    const range = await graph(token, `${root}/worksheets/${encodeURIComponent(destination.id)}/range(address='A1:H1')`);
    const firstRow = Array.isArray(range.values?.[0]) ? range.values[0].map(String) : [];
    if (firstRow.some((value: string) => value && value !== "null") && !mkssHeaders.every((header, index) => firstRow[index] === header)) throw new Error("Choose an empty worksheet or one already headed with MKSS columns");
  } else {
    const range = await graph(token, `${root}/tables/${encodeURIComponent(destination.id)}/headerRowRange`);
    const headers = Array.isArray(range.values?.[0]) ? range.values[0].map(String) : [];
    if (headers.length !== mkssHeaders.length || !mkssHeaders.every((header, index) => headers[index] === header)) throw new Error(`This table needs these columns: ${mkssHeaders.join(", ")}`);
  }
}
