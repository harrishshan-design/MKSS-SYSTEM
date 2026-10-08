import { createHmac, timingSafeEqual } from "node:crypto";

const STEP_MS = 30_000;
const CODE_RE = /^MKSS1:(A|D):([0-9a-f-]+):([0-9]+):([A-Za-z0-9_-]{22})$/;
const DAILY_RE = /^MKSS2:A:(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_-]{22})$/;

function signature(secret: string, kind: "A" | "D", subject: string, slot: number) {
  return createHmac("sha256", secret).update(`${kind}:${subject}:${slot}`).digest("base64url").slice(0, 22);
}

function make(kind: "A" | "D", subject: string, secret: string, now: number) {
  const slot = Math.floor(now / STEP_MS);
  return `MKSS1:${kind}:${subject}:${slot}:${signature(secret, kind, subject, slot)}`;
}

function verify(code: string, kind: "A" | "D", subject: string, secret: string, now: number) {
  const match = CODE_RE.exec(code);
  if (!match || match[1] !== kind || match[2] !== subject) return false;
  const slot = Number(match[3]);
  const current = Math.floor(now / STEP_MS);
  if (!Number.isSafeInteger(slot) || slot > current || slot < current - 1) return false;
  const expected = Buffer.from(signature(secret, kind, subject, slot));
  const received = Buffer.from(match[4]);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const dailyCode = (date: string, secret: string) => `MKSS2:A:${date}:${signature(secret, "A", date, 0)}`;
export function verifyDailyCode(code: string, date: string, secret: string) {
  const match = DAILY_RE.exec(code);
  if (!match || match[1] !== date) return false;
  const expected = Buffer.from(signature(secret, "A", date, 0));
  const received = Buffer.from(match[2]);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
export const driverPassCode = (driverId: string, secret: string, now = Date.now()) => make("D", driverId, secret, now);
export const verifyDriverPassCode = (code: string, driverId: string, secret: string, now = Date.now()) => verify(code, "D", driverId, secret, now);

export function driverIdFromPass(code: string): string | null {
  const match = CODE_RE.exec(code);
  return match?.[1] === "D" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(match[2]) ? match[2] : null;
}
