"use client";
import { useEffect, useId, useState } from "react";
import { Camera, Keyboard, X } from "lucide-react";
export default function Scanner({onScan,onClose,title="Scan QR code"}:{onScan:(value:string)=>void;onClose:()=>void;title?:string}) {
  const id=useId().replace(/:/g,""); const [manual,setManual]=useState(""); const [cameraError,setCameraError]=useState("");
  useEffect(()=>{ let scanner:import("html5-qrcode").Html5Qrcode|undefined; let stopped=false;
    import("html5-qrcode").then(async({Html5Qrcode})=>{if(stopped)return; scanner=new Html5Qrcode(id); try { await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:240,height:240}},async(decoded)=>{if(stopped)return; stopped=true; await scanner?.stop().catch(()=>{}); onScan(decoded.trim());},()=>{}); } catch(error) { setCameraError(error instanceof Error?error.message:"Camera unavailable"); }});
    return()=>{stopped=true; scanner?.stop().catch(()=>{});};
  },[id,onScan]);
  return <div className="modal-backdrop" role="presentation"><div className="modal scanner-modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><span className="eyebrow">CAMERA SCANNER</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20}/></button></div><div id={id} className="camera-box"/><p className="muted center">Place the QR code inside the frame. Scanning stops after detection.</p>{cameraError&&<div className="notice error">{cameraError}. You can enter the code below.</div>}<label className="field-label"><Keyboard size={16}/> Enter QR ID manually<input value={manual} onChange={e=>setManual(e.target.value)} placeholder="Paste QR UUID"/></label><button className="button primary full" disabled={!manual.trim()} onClick={()=>onScan(manual.trim())}>Look up code</button></div></div>;
}
