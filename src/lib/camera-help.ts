export const CAMERA_DEVICES = {
  "android-chrome": "Android · Chrome",
  "iphone-safari": "iPhone / iPad · Safari",
  "iphone-chrome": "iPhone / iPad · Chrome",
  "android-other": "Android · another browser",
  "iphone-other": "iPhone / iPad · another browser",
  desktop: "Computer / another device",
} as const;
export type CameraDevice = keyof typeof CAMERA_DEVICES;
export type CameraIssue = "denied" | "busy" | "missing" | "unavailable";
export function cameraIssue(error: unknown): CameraIssue {
  const message = typeof error === "object" && error !== null
    ? `${"name" in error ? error.name : ""} ${"message" in error ? error.message : ""}` : String(error);
  if (/NotAllowed|PermissionDenied|permission|denied|SecurityError/i.test(message)) return "denied";
  if (/NotReadable|TrackStart|in use|could not start|busy/i.test(message)) return "busy";
  if (/NotFound|DevicesNotFound|no camera|no.*device|Overconstrained/i.test(message)) return "missing";
  return "unavailable";
}
export function cameraDevice(userAgent: string, maxTouchPoints = 0): CameraDevice {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  if (ios) {
    if (/CriOS/i.test(userAgent)) return "iphone-chrome";
    if (/Safari/i.test(userAgent) && !/FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram/i.test(userAgent)) return "iphone-safari";
    return "iphone-other";
  }
  if (/Android/i.test(userAgent)) return /Chrome/i.test(userAgent) && !/SamsungBrowser|EdgA|OPR|; wv\)|FBAV|Instagram/i.test(userAgent) ? "android-chrome" : "android-other";
  return "desktop";
}
export function embeddedBrowser(userAgent: string) { return /FBAN|FBAV|Instagram|; wv\)|Line\//i.test(userAgent); }
export function cameraSteps(device: CameraDevice): string[] {
  switch (device) {
    case "android-chrome": return [
      "In Chrome, tap ⋮ → Settings → Site settings → Camera.",
      "Allow sites to ask for the camera. If this MKSS site is listed under Blocked, tap it and choose Allow.",
      "If still blocked: open phone Settings → Apps → Chrome → Permissions → Camera → Allow while using the app. Turn on the phone’s Camera access privacy switch if it is off.",
      "Return to MKSS and tap Try camera again. Choose Allow if asked.",
    ];
    case "iphone-safari": return [
      "In Safari, tap the page menu beside the address (aA on some versions), then More / Website Settings.",
      "For this MKSS website, change Camera to Allow or Ask.",
      "If needed, open iPhone Settings → Apps → Safari → Camera (or Settings → Safari on older versions) and choose Ask or Allow. Check Screen Time restrictions if Camera is unavailable.",
      "Return to MKSS and tap Try camera again. Choose Allow if asked.",
    ];
    case "iphone-chrome": return [
      "In Chrome, tap the camera icon beside the address, if shown, and turn camera permission on for this MKSS site.",
      "Open iPhone Settings → Apps → Chrome → Camera and turn it on (or Settings → Chrome on older versions).",
      "Return to MKSS and tap Try camera again. Choose Allow if asked.",
    ];
    case "android-other": return [
      "Open your browser’s site settings or permissions for this MKSS website and allow Camera. Menu names vary by browser.",
      "Open phone Settings → Apps → your browser → Permissions → Camera → Allow while using the app. Check the phone’s Camera access privacy switch too.",
      "Return and tap Try camera again. If camera settings are unavailable, open MKSS in Chrome instead.",
    ];
    case "iphone-other": return [
      "Open MKSS directly in Safari or Chrome, rather than inside a messaging or social app.",
      "For your browser, open iPhone Settings → Apps → the browser → Camera and allow access, if listed. In Safari, use the page menu → Website Settings → Camera → Allow.",
      "Return and tap Try camera again. Choose Allow if asked.",
    ];
    default: return [
      "Open the site permissions menu beside the MKSS address and change Camera to Allow or Ask.",
      "In your device’s privacy settings, allow camera access for your browser. Close other apps using the camera.",
      "Return to MKSS and tap Try camera again. Choose Allow if asked.",
    ];
  }
}
