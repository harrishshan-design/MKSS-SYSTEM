import { describe, expect, it } from "vitest";
import { tripDeadline } from "./trip-type";

describe("corrected driver trip deadlines", () => {
  const enteredAt = "2026-10-15T01:00:00.000Z";

  it("sets a 30 minute deadline for loading, unloading, and RORO trips", () => {
    expect(tripDeadline(enteredAt, "Ambil Barang")).toBe("2026-10-15T01:30:00.000Z");
    expect(tripDeadline(enteredAt, "Hantar Barang")).toBe("2026-10-15T01:30:00.000Z");
    expect(tripDeadline(enteredAt, "RORO Biru")).toBe("2026-10-15T01:30:00.000Z");
    expect(tripDeadline(enteredAt, "RORO Oren")).toBe("2026-10-15T01:30:00.000Z");
  });

  it("sets a two hour deadline for manual loading and Tank Farm", () => {
    expect(tripDeadline(enteredAt, "Manual")).toBe("2026-10-15T03:00:00.000Z");
    expect(tripDeadline(enteredAt, "Tank Farm")).toBe("2026-10-15T03:00:00.000Z");
  });

  it("leaves an unstarted trip without a deadline", () => {
    expect(tripDeadline(null, "Manual")).toBeNull();
  });
});
