"use client";
import { useEffect, useId, useState } from "react";
import { Camera } from "lucide-react";
import { CAMERA_DEVICES, cameraDevice, cameraSteps, embeddedBrowser, type CameraDevice, type CameraIssue } from "@/lib/camera-help";

export default function CameraHelp({ issue, onRetry }: { issue: CameraIssue; onRetry: () => void }) {
  const id = useId();
  const [device, setDevice] = useState<CameraDevice>("desktop");
  const [embedded, setEmbedded] = useState(false), [installed, setInstalled] = useState(false);
  useEffect(() => {
    setDevice(cameraDevice(navigator.userAgent, navigator.maxTouchPoints));
    setEmbedded(embeddedBrowser(navigator.userAgent));
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  }, []);
  return <section className="camera-help" aria-labelledby={`${id}-help`} aria-live="polite">
      <h3 id={`${id}-help`}>{issue === "denied" ? "Camera permission is blocked" : issue === "busy" ? "Camera is busy" : issue === "missing" ? "No usable camera found" : "Camera could not start"}</h3>
      <p>{issue === "denied" ? "Tapped Don’t allow by mistake? Follow these steps to allow the camera again." : issue === "busy" ? "Close other apps or browser tabs using the camera, then retry. If needed, check permissions below." : issue === "missing" ? "Check that this device has an available camera. You can also use another phone or enter the QR code below." : "Check your internet connection and use an up-to-date browser over HTTPS. You can also check camera permissions below."}</p>
      <label>Phone / browser<select value={device} onChange={event => setDevice(event.target.value as CameraDevice)}>{Object.entries(CAMERA_DEVICES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {embedded && <p><strong>Opened inside another app?</strong> Use its menu to open this MKSS link in Safari or Chrome.</p>}
      {installed && <p><strong>Using the installed MKSS app?</strong> If the address menu is hidden, open this same MKSS website in your phone’s browser to change camera permissions, then return here.</p>}
      <ol>{cameraSteps(device).map(step => <li key={step}>{step}</li>)}</ol>
      <p className="muted">Menu names can vary. MKSS cannot change phone permissions for you. If the camera stays blocked, allow it in Settings and reopen the scanner.</p>
      <button className="button primary full" onClick={onRetry}><Camera size={18}/>Try camera again</button>
    </section>;
}
