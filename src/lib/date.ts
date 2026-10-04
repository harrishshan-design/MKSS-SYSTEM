export function siteDate(date = new Date()) { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit"}).format(date); }
export function siteDateTime(value: string | null | undefined) {
  return value ? `${new Date(value).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} MYT` : "—";
}
export function siteClockTime(value: string | null | undefined) {
  return value ? `${new Date(value).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" })} MYT` : "—";
}
