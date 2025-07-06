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

/** IBR-147-AE: multiply the decimal quantity exactly, then round half up to whole fils. */
export function lineNet(price: Fils, qty: number): Fils | null {
  if (!Number.isFinite(qty) || !Number.isSafeInteger(price)) return null;
  const [mantissa, exponent = "0"] = String(qty).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(price) * BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, -scale));
  const denominator = 10n ** BigInt(Math.max(0, scale));
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute * 2n + denominator) / (denominator * 2n);
  const net = Number(numerator < 0n ? -rounded : rounded);
  return Number.isSafeInteger(net) ? net : null;
}

/** ALIGNED-IBRP-S-08: numerically equal rates belong to the same VAT breakdown. */
export function normalizedRate(rate: string): string {
  if (!validRate(rate)) return rate;
  const [whole, fraction = ""] = rate.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return whole.replace(/^0+(?=\d)/, "") + (decimals ? `.${decimals}` : "");
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
