// The invoice as finance drafts it, before it becomes a PINT AE electronic invoice.

export interface Party {
  name: string;
  trn: string | null; // 15-digit Tax Registration Number; the first 10 digits are the TIN
  legal_id: string | null; // trade licence, Emirates ID, passport or Cabinet Decision number
  legal_id_type: "TL" | "EID" | "PAS" | "CD" | null;
  address_line: string | null;
  city: string | null;
  subdivision: string | null; // the emirate
  country: string | null; // ISO 3166-1 alpha-2
}

export interface Customer extends Party {
  code: string;
  sector: string;
}

export interface Line {
  part_number: string;
  name: string;
  description: string;
  qty: number;
  unit_price: string; // exact decimal string, e.g. "1234.50"
  unit_code: string; // UN/ECE Rec 20: H87 piece, C62 one
  tax_category: "S" | "Z" | "E" | "O" | "AE" | "N";
  tax_rate: string; // percent, e.g. "5"
}

export interface InvoiceDraft {
  id: string;
  issue_date: string; // YYYY-MM-DD
  due_date: string | null;
  currency: string;
  customer: string; // customer code
  customer_po: string;
  type_code: string; // 380 commercial invoice, 480 out of scope of tax
  transaction_flags: string; // 8 positions of 0/1
  payment_means: string | null; // UNCL4461
  lines: Line[];
}

export interface Samples {
  seller: Party;
  customers: Customer[];
  invoices: InvoiceDraft[];
}
