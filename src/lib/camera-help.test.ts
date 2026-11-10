import { describe, expect, it } from "vitest";
import { CAMERA_DEVICES, cameraDevice, cameraIssue, cameraSteps, embeddedBrowser } from "./camera-help";

describe("camera permission recovery", () => {
  it("recognizes native errors, html5-qrcode strings and browser permission objects", () => {
    expect(cameraIssue(new DOMException("Permission denied", "NotAllowedError"))).toBe("denied");
    expect(cameraIssue("NotAllowedError: Permission denied by system")).toBe("denied");
    expect(cameraIssue({ name: "SecurityError", message: "Blocked" })).toBe("denied");
    expect(cameraIssue("NotReadableError: Could not start video source")).toBe("busy");
    expect(cameraIssue({ name: "NotFoundError" })).toBe("missing");
    expect(cameraIssue("OverconstrainedError")).toBe("missing");
    expect(cameraIssue(new Error("Module failed"))).toBe("unavailable");
    expect(cameraIssue(null)).toBe("unavailable");
  });
  it("chooses phone and browser instructions without treating every iPhone browser as Safari", () => {
    expect(cameraDevice("iPhone AppleWebKit Version/18 Mobile Safari/604")).toBe("iphone-safari");
    expect(cameraDevice("iPhone AppleWebKit CriOS/130 Mobile Safari/604")).toBe("iphone-chrome");
    expect(cameraDevice("iPhone FxiOS/130 Mobile Safari/604")).toBe("iphone-other");
    expect(cameraDevice("Macintosh AppleWebKit Version/18 Safari/604", 5)).toBe("iphone-safari");
    expect(cameraDevice("Macintosh AppleWebKit Version/18 Safari/604", 0)).toBe("desktop");
    expect(cameraDevice("Android Chrome/130 Mobile Safari/537")).toBe("android-chrome");
    expect(cameraDevice("Android Chrome/130 SamsungBrowser/25")).toBe("android-other");
    expect(cameraDevice("Android Firefox/130")).toBe("android-other");
    expect(cameraDevice("Android Chrome/130 EdgA/130")).toBe("android-other");
    expect(cameraDevice("Windows NT Chrome/130")).toBe("desktop");
  });
  it("handles embedded browsers and supplies retry guidance for every selectable device", () => {
    for (const ua of ["iPhone FBAN/FBIOS", "Android; wv) Chrome/130", "iPhone Instagram", "Android Line/13"])
      expect(embeddedBrowser(ua)).toBe(true);
    expect(embeddedBrowser("Android Chrome/130")).toBe(false);
    for (const key of Object.keys(CAMERA_DEVICES) as (keyof typeof CAMERA_DEVICES)[]) {
      expect(cameraSteps(key).length).toBeGreaterThanOrEqual(3);
      expect(cameraSteps(key).join(" ")).toContain("Try camera again");
    }
  });
});
