import { FIELDS, type FieldDef } from "./fields";
import type { Computed } from "./compute";

// Is a draft ready to go out as a UAE electronic tax invoice? Every mandatory field must be present and well
// formed, and the codes and arithmetic must follow the PINT AE rules. Each problem is one sentence that says
// what to fix and where (the invoice, or the customer or company record it comes from).

export type Where = "invoice" | "customer" | "company";

export interface Finding {
  field: number; // the Ministry's field number (1 to 51)
  where: Where;
  message: string;
  line?: number;
}

const TRN = /^100\d{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = new Set(["AED", "USD", "EUR", "GBP", "SAR", "INR", "QAR", "OMR", "KWD", "BHD", "JPY", "CNY"]);
const TAX_CATEGORIES = new Set(["S", "Z", "E", "O", "AE", "N"]);
const ID_TYPES = new Set(["TL", "EID", "PAS", "CD"]);
const INVOICE_TYPES = new Set(["380", "480"]);

function realDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function where(f: FieldDef): Where {
  return f.section === "Buyer" ? "customer" : f.section === "Seller" ? "company" : "invoice";
}

export function validate(c: Computed): Finding[] {
  const out: Finding[] = [];
  const add = (field: number, w: Where, message: string, line?: number) => out.push({ field, where: w, message, line });

  if (!c.buyer) add(21, "invoice", `No customer record for code ${c.draft.customer}.`);

  // 1. Every mandatory field has a value.
  for (const f of FIELDS) {
    if (f.section === "Invoice line") {
      for (const l of c.lines) if (!f.value(c, l)) add(f.n, "invoice", `Line ${l.n}: ${f.name.toLowerCase()} is missing.`, l.n);
    } else if (!f.value(c)) {
      // An electronic address that is missing because the TRN is wrong is explained once, at the TRN.
      if ([11, 12, 16, 22, 23, 25].includes(f.n)) continue;
      add(f.n, where(f), `${f.name} is missing.`);
    }
  }
  if (c.lines.length === 0) add(39, "invoice", "The invoice has no lines.");

  // 2. Formats and codes.
  const d = c.draft;
  if (d.issue_date && !realDate(d.issue_date)) add(2, "invoice", `Invoice date ${d.issue_date} is not a real date in YYYY-MM-DD form.`);
  if (d.due_date && !realDate(d.due_date)) add(6, "invoice", `Payment due date ${d.due_date} is not a real date in YYYY-MM-DD form.`);
  if (d.due_date && d.issue_date && realDate(d.due_date) && realDate(d.issue_date) && d.due_date < d.issue_date) {
    add(6, "invoice", `Payment is due (${d.due_date}) before the invoice is issued (${d.issue_date}).`);
  }
  if (!INVOICE_TYPES.has(d.type_code)) add(3, "invoice", `Invoice type code ${d.type_code} is not allowed: use 380 (commercial invoice) or 480 (out of scope of tax).`);
  if (d.currency && !CURRENCIES.has(d.currency)) add(4, "invoice", `Currency ${d.currency} is not a known ISO 4217 code.`);
  if (!/^[01]{8}$/.test(d.transaction_flags)) add(5, "invoice", `Transaction type must be 8 positions of 0 or 1; it is "${d.transaction_flags}".`);
  if (d.payment_means && !/^\d{1,3}$|^ZZZ$/.test(d.payment_means)) add(9, "invoice", `Payment means ${d.payment_means} is not a UNCL 4461 code (for example 30, credit transfer).`);

  const trnCheck = (trn: string | null, n: number, w: Where, who: string) => {
    if (!trn) {
      add(n, w, `${who} has no TRN on file, so the invoice has no ${who.toLowerCase()} tax identifier and no electronic address (the TIN is the TRN's first 10 digits).`);
    } else if (!TRN.test(trn)) {
      const digits = trn.replace(/\D/g, "").length;
      add(n, w, `${who} TRN ${trn} has ${digits} digits; a TRN has 15 and starts with 100. Without it there is no electronic address to send the invoice to.`);
    }
  };
  trnCheck(c.seller.trn, 15, "company", "Seller");
  if (c.buyer) trnCheck(c.buyer.trn, 24, "customer", "Customer");
  if (c.seller.legal_id_type && !ID_TYPES.has(c.seller.legal_id_type)) {
    add(14, "company", `Legal registration type ${c.seller.legal_id_type} must be TL, EID, PAS or CD.`);
  }
  for (const [p, n, w] of [[c.seller, 20, "company"], [c.buyer, 29, "customer"]] as const) {
    if (p?.country && !/^[A-Z]{2}$/.test(p.country)) add(n, w, `Country ${p.country} must be a two-letter ISO code (AE for the UAE).`);
  }

  // 3. Lines: codes, rates, and what the transaction flags imply.
  const exports = d.transaction_flags[7] === "1";
  for (const l of c.lines) {
    if (!TAX_CATEGORIES.has(l.tax_category)) add(46, "invoice", `Line ${l.n}: tax category ${l.tax_category} is not one of S, Z, E, O, AE, N.`, l.n);
    if (l.tax_category === "S" && Number(l.tax_rate) !== 5) add(47, "invoice", `Line ${l.n}: standard rate (S) is 5% in the UAE, not ${l.tax_rate}%.`, l.n);
    if (["Z", "E", "O"].includes(l.tax_category) && Number(l.tax_rate) !== 0) add(47, "invoice", `Line ${l.n}: category ${l.tax_category} carries no VAT, but the rate is ${l.tax_rate}%.`, l.n);
    if (l.qty <= 0) add(40, "invoice", `Line ${l.n}: quantity must be above zero.`, l.n);
    if (l.price < 0) add(43, "invoice", `Line ${l.n}: the net price cannot be negative.`, l.n);
    if (!/^[A-Z0-9]{2,3}$/.test(l.unit_code)) add(41, "invoice", `Line ${l.n}: unit ${l.unit_code} is not a UN/ECE Rec 20 code (H87 piece, C62 one).`, l.n);
    if (exports && l.tax_category === "S") add(46, "invoice", `Line ${l.n}: the invoice is flagged as an export but this line charges 5% VAT; exports are normally zero-rated (Z).`, l.n);
  }
  return out;
}

/** Fields (by number) that are present and pass, for the 51-field checklist. */
export function fieldStatus(c: Computed, findings: Finding[]): Map<number, "ok" | "problem"> {
  const bad = new Set(findings.map((f) => f.field));
  return new Map(
    FIELDS.map((f) => {
      const empty = f.section === "Invoice line" ? c.lines.some((l) => !f.value(c, l)) || c.lines.length === 0 : !f.value(c);
      return [f.n, bad.has(f.n) || empty ? "problem" : "ok"];
    }),
  );
}
