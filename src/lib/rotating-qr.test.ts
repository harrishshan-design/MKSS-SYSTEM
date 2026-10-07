import { describe, expect, it } from "vitest";
import { dailyCode, driverIdFromPass, driverPassCode, verifyDailyCode, verifyDriverPassCode } from "./rotating-qr";

const secret = "b4825364-3ce9-4598-9635-81019adcc892";
const driverId = "71f6eb92-046c-4d33-ae4c-e393358234bb";
const at = Date.UTC(2026, 9, 8, 1, 0, 0);

describe("short-lived QR challenges", () => {
  it("accepts the current and previous 30-second window, then expires", () => {
    const code = dailyCode("2026-10-08", secret, at);
    expect(verifyDailyCode(code, "2026-10-08", secret, at + 45_000)).toBe(true);
    expect(verifyDailyCode(code, "2026-10-08", secret, at + 60_000)).toBe(false);
    expect(verifyDailyCode(code, "2026-10-09", secret, at)).toBe(false);
    expect(verifyDailyCode(code, "2026-10-08", "wrong", at)).toBe(false);
  });

  it("ties a pass to its driver and rejects tampering", () => {
    const code = driverPassCode(driverId, secret, at);
    expect(driverIdFromPass(code)).toBe(driverId);
    expect(verifyDriverPassCode(code, driverId, secret, at)).toBe(true);
    expect(verifyDriverPassCode(code.slice(0, -1) + "X", driverId, secret, at)).toBe(false);
    expect(verifyDriverPassCode(code, "12611eca-1469-4959-8ae0-eb5e58f1a7e5", secret, at)).toBe(false);
    expect(driverIdFromPass(secret)).toBe(null);
  });
});
