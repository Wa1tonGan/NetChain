/* Time & date formatting helpers. */

export function daysAgo(d: number, h: number, m: number): number {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, m, 0, 0);
  return t.getTime();
}

export const fmtClock = (ts: number): string => {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
};

export const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  return (
    d.getDate() +
    " " +
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]
  );
};

export const dayLabel = (ts: number): string => {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return "Today";
  if (ts >= startToday - 86400000) return "Yesterday";
  return fmtDate(ts);
};
