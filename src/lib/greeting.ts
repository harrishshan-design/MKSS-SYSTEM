export function adminGreeting(name: string, now: number) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date(now)));
  const period = hour < 12 ? "MORNING" : hour < 17 ? "AFTERNOON" : "EVENING";
  const trimmed = name.trim();
  const displayName = trimmed.toLowerCase() === "site administrator"
    ? "MK"
    : /^dr\.?\s/i.test(trimmed)
      ? trimmed
      : trimmed.split(/\s+/)[0] || "ADMIN";

  return `GOOD ${period} ${displayName.toLocaleUpperCase("en-MY")}`;
}
