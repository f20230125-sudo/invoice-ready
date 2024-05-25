import { FIELDS, type FieldDef } from "./fields";
import type { Computed } from "./compute";
import { validRate } from "./money";

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

// IBR-132-AE: 15 digits, starting with 1 and ending in 03 (UAE TRNs start with 100).
const TRN = /^100\d{10}03$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = new Set(["AED", "USD", "EUR", "GBP", "SAR", "INR", "QAR", "OMR", "KWD", "BHD", "JPY", "CNY"]);
const TAX_CATEGORIES = new Set(["S", "Z", "E", "O", "AE", "N"]);
const ID_TYPES = new Set(["TL", "EID", "PAS", "CD"]);
const INVOICE_TYPES = new Set(["380", "480"]);
// IBR-128-AE: UAE addresses use the seven emirate codes.
const EMIRATES = new Set(["AUH", "DXB", "SHJ", "UAQ", "FUJ", "AJM", "RAK"]);
// IBR-CL-16 and the PINT AE UNCL4461 subset.
const PAYMENT_MEANS = new Set(["1", "10", "20", "21", "30", "49", "54", "55", "68"]);
// IBR-CL-14: PINT AE ISO3166 list, including its additional codes 1A and XI.
const COUNTRIES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW 1A XI"
).split(" "));

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
  if (d.payment_means && !PAYMENT_MEANS.has(d.payment_means)) add(9, "invoice", `Payment means ${d.payment_means} is not a permitted UAE UNCL 4461 code (for example 30, credit transfer).`);

  const trnCheck = (trn: string | null, n: number, w: Where, who: string) => {
    if (!trn) {
      add(n, w, `${who} has no TRN on file, so the invoice has no ${who.toLowerCase()} tax identifier and no electronic address (the TIN is the TRN's first 10 digits).`);
    } else if (!TRN.test(trn)) {
      const digits = trn.replace(/\D/g, "").length;
      const shape = digits === 15 ? "is 15 digits but does not start with 100 and end in 03" : `has ${digits} digits`;
      add(n, w, `${who} TRN ${trn} ${shape}; a TRN has 15 digits, starts with 100 and ends in 03. Without it there is no electronic address to send the invoice to.`);
    }
  };
  trnCheck(c.seller.trn, 15, "company", "Seller");
  if (c.buyer) trnCheck(c.buyer.trn, 24, "customer", "Customer");
  if (c.seller.legal_id_type && !ID_TYPES.has(c.seller.legal_id_type)) {
    add(14, "company", `Legal registration type ${c.seller.legal_id_type} must be TL, EID, PAS or CD.`);
  }
  for (const [p, n, w] of [[c.seller, 20, "company"], [c.buyer, 29, "customer"]] as const) {
    if (p?.country && !COUNTRIES.has(p.country)) add(n, w, `Country ${p.country} is not in the PINT AE country code list (AE for the UAE).`);
    if (p?.country === "AE" && !EMIRATES.has(p.subdivision ?? "")) add(n - 1, w, `Country subdivision ${p.subdivision ?? "(missing)"} must be AUH, DXB, SHJ, UAQ, FUJ, AJM or RAK for a UAE address.`);
    // IBR-172-AE (seller), IBR-101-AE (buyer): trade licences require an issuing authority.
    if (p?.legal_id_type === "TL" && !p.legal_id_authority?.trim()) add(w === "company" ? 14 : 21, w, "Trade licence issuing authority is missing.");
  }

  // 3. Lines: codes, rates, and what the transaction flags imply.
  const exports = d.transaction_flags[7] === "1";
  // IBR-152-AE: exports require an overseas delivery address.
  if (exports) {
    const a = d.delivery;
    if (!a?.address_line?.trim() || !a.city?.trim() || !a.subdivision?.trim() || !a.country || a.country === "AE" || !COUNTRIES.has(a.country)) {
      add(5, "invoice", "An export needs a delivery address with street, city, subdivision and a valid country code outside the UAE.");
    }
  }
  for (const l of c.lines) {
    if (!TAX_CATEGORIES.has(l.tax_category)) add(46, "invoice", `Line ${l.n}: tax category ${l.tax_category} is not one of S, Z, E, O, AE, N.`, l.n);
    if (!validRate(l.tax_rate)) add(47, "invoice", `Line ${l.n}: tax rate must be a finite, nonnegative decimal percentage; it is "${l.tax_rate}".`, l.n);
    // ALIGNED-IBRP-E-05 and IBR-167-AE: hold E until reason codes and rate omission are supported.
    if (l.tax_category === "E") add(46, "invoice", `Line ${l.n}: exempt VAT (E) needs an exemption reason and category-specific XML, which are not supported yet.`, l.n);
    // IBR-122-AE: type 480 permits only E, O and Z categories.
    if (d.type_code === "480" && !["E", "O", "Z"].includes(l.tax_category)) add(46, "invoice", `Line ${l.n}: invoice type 480 only permits tax categories E, O or Z.`, l.n);
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
