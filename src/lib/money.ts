// Money in whole fils (1/100 of a dirham) so sums never pick up floating-point dust.

export type Fils = number;

export function toFils(amount: string | number): Fils {
  const s = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`not an amount: ${amount}`);
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const fils = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -fils : fils;
}

/** Fils to a decimal string with exactly two places, as UBL wants it: 1234567 -> "12345.67". */
export function amount(fils: Fils): string {
  const negative = fils < 0;
  const abs = Math.abs(fils);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function validRate(rate: string): boolean {
  return /^\d+(\.\d+)?$/.test(rate) && Number.isFinite(Number(rate));
}

/** Rate is a percent string ("5"); half-up rounding to the fils, as tax is computed per line and per category. */
export function percentOf(fils: Fils, rate: string): Fils {
  const r = Number(rate);
  return Math.round((fils * r) / 100 + Number.EPSILON * Math.sign(fils));
}

const display = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function show(fils: Fils): string {
  return display.format(fils / 100);
}
