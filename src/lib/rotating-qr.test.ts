import { describe, expect, it } from "vitest";
import { dailyCode, driverIdFromPass, driverPassCode, verifyDailyCode, verifyDriverPassCode } from "./rotating-qr";

const secret = "b4825364-3ce9-4598-9635-81019adcc892";
const driverId = "71f6eb92-046c-4d33-ae4c-e393358234bb";
const at = Date.UTC(2026, 9, 8, 1, 0, 0);

describe("daily attendance and rotating driver QR challenges", () => {
  it("uses one attendance code for the day and rejects it on the next day", () => {
    const code = dailyCode("2026-10-08", secret);
    expect(dailyCode("2026-10-08", secret)).toBe(code);
    expect(verifyDailyCode(code, "2026-10-08", secret)).toBe(true);
    expect(verifyDailyCode(code, "2026-10-09", secret)).toBe(false);
    expect(verifyDailyCode(code, "2026-10-08", "wrong")).toBe(false);
    expect(dailyCode("2026-10-09", secret)).not.toBe(code);
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
