import { lineNet, normalizedRate, percentOf, toFils, validRate, type Fils } from "./money";
import type { Customer, InvoiceDraft, Party } from "./types";

// Everything the electronic invoice states, computed once from the draft and the master data.

export interface ComputedLine {
  n: number;
  part_number: string;
  name: string;
  description: string;
  qty: number;
  unit_code: string;
  price: Fils;
  net: Fils; // IBT-131 = qty x price
  tax_category: string;
  tax_rate: string;
  vat_aed: Fils; // BTAE-08
  total_aed: Fils; // BTAE-10 = net + VAT
}

export interface TaxSubtotal {
  category: string;
  rate: string;
  taxable: Fils; // IBT-116
  tax: Fils; // IBT-117
}

export interface Computed {
  draft: InvoiceDraft;
  seller: Party;
  buyer: Customer | null;
  lines: ComputedLine[];
  subtotals: TaxSubtotal[];
  line_total: Fils; // IBT-106
  tax_exclusive: Fils; // IBT-109
  tax_total: Fils; // IBT-110
  tax_inclusive: Fils; // IBT-112
  payable: Fils; // IBT-115
}

export const SPECIFICATION_ID = "urn:peppol:pint:billing-1@ae-1"; // IBT-024 (from the PINT AE document type id)
export const BUSINESS_PROCESS = "urn:peppol:bis:billing"; // IBT-023 (Peppol billing process; see README)
export const ENDPOINT_SCHEME = "0235"; // UAE businesses' electronic address scheme (MoF mandatory fields, field 12)

/** The TIN is the first 10 digits of the 15-digit TRN (MoF mandatory fields, glossary). */
export function tin(trn: string | null): string | null {
  return trn && /^\d{15}$/.test(trn) ? trn.slice(0, 10) : null;
}

export function compute(draft: InvoiceDraft, seller: Party, customers: Customer[]): Computed {
  const buyer = customers.find((c) => c.code === draft.customer) ?? null;
  const lines = draft.lines.map((l, i) => {
    const price = toFils(l.unit_price);
    const net = lineNet(price, l.qty) ?? 0; // Held drafts use a finite placeholder for read-back.
    // ALIGNED-IBRP-AE-09-AE: reverse-charge VAT is not charged to the buyer.
    const vat = l.tax_category === "AE" || !validRate(l.tax_rate) ? 0 : percentOf(net, l.tax_rate);
    return {
      n: i + 1, part_number: l.part_number, name: l.name, description: l.description, qty: l.qty, unit_code: l.unit_code,
      price, net, tax_category: l.tax_category, tax_rate: l.tax_rate, vat_aed: vat, total_aed: net + vat,
    };
  });
  const groups = new Map<string, TaxSubtotal>();
  for (const l of lines) {
    // ALIGNED-IBRP-O-01/11-AE: O has one breakdown and no percentage.
    const rate = l.tax_category === "O" ? "" : normalizedRate(l.tax_rate);
    const key = `${l.tax_category}|${rate}`;
    const g = groups.get(key) ?? { category: l.tax_category, rate, taxable: 0, tax: 0 };
    g.taxable += l.net;
    groups.set(key, g);
  }
  // Tax per category is computed on the category's taxable total (IBR-CO-14 sums these).
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: g.category === "AE" || !validRate(g.rate) ? 0 : percentOf(g.taxable, g.rate) }));
  const line_total = lines.reduce((s, l) => s + l.net, 0);
  const tax_total = subtotals.reduce((s, g) => s + g.tax, 0);
  return {
    draft, seller, buyer, lines, subtotals, line_total, tax_exclusive: line_total, tax_total,
    tax_inclusive: line_total + tax_total, payable: line_total + tax_total,
  };
}
