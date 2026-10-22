// The go-live dates set by Ministerial Decision 244 of 2025 (as amended in 2026).
export const GO_LIVE = [
  { date: "2027-01-01", who: "businesses with revenue of AED 50 million or more" },
  { date: "2027-07-01", who: "businesses below AED 50 million" },
  { date: "2027-10-01", who: "government entities" },
];

export function daysUntil(iso: string, today = new Date()): number {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000);
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
