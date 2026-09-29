import type { Metadata, Viewport } from "next";
import "./styles.css";
export const metadata:Metadata={title:"MKSS SYSTEM | Lorry operations",description:"Lorry movement, security attendance and site visibility",manifest:"/manifest.webmanifest"};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#163f31"};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
