import { amount } from "./money";
import { BUSINESS_PROCESS, ENDPOINT_SCHEME, SPECIFICATION_ID, tin, type Computed, type ComputedLine } from "./compute";

// The 51 mandatory fields of a UAE electronic tax invoice, in the order and wording of the Ministry of Finance's
// "UAE Electronic Invoice Mandatory Fields" (version 1.0, 23 February 2026), each tied to its Peppol PINT AE
// business term and the UBL element that carries it (docs.peppol.eu/poac/ae/pint-ae, syntax binding).
// Paths are relative to the Invoice (or to the InvoiceLine for fields 39 to 51); "@x" is an attribute.

export type Section = "Invoice details" | "Seller" | "Buyer" | "Document totals" | "Tax breakdown" | "Invoice line";

export interface FieldDef {
  n: number;
  name: string;
  section: Section;
  term: string;
  path: string;
  value: (c: Computed, line?: ComputedLine) => string | null;
}

const SUP = "AccountingSupplierParty/Party";
const CUS = "AccountingCustomerParty/Party";
const first = (c: Computed) => c.subtotals[0];

/** ALIGNED-IBRP-O-05 and ALIGNED-IBRP-O-11-AE: O percentages must be absent. */
export function requiredField(n: number, category?: string): boolean {
  return !([38, 47].includes(n) && category === "O");
}

export const FIELDS: FieldDef[] = [
  { n: 1, name: "Invoice number", section: "Invoice details", term: "IBT-001", path: "ID", value: (c) => c.draft.id },
  { n: 2, name: "Invoice date", section: "Invoice details", term: "IBT-002", path: "IssueDate", value: (c) => c.draft.issue_date },
  { n: 3, name: "Invoice type code", section: "Invoice details", term: "IBT-003", path: "InvoiceTypeCode", value: (c) => c.draft.type_code },
  { n: 4, name: "Invoice currency code", section: "Invoice details", term: "IBT-005", path: "DocumentCurrencyCode", value: (c) => c.draft.currency },
  { n: 5, name: "Invoice transaction type code", section: "Invoice details", term: "BTAE-02", path: "ProfileExecutionID", value: (c) => c.draft.transaction_flags },
  { n: 6, name: "Payment due date", section: "Invoice details", term: "IBT-009", path: "DueDate", value: (c) => c.draft.due_date },
  { n: 7, name: "Business process type", section: "Invoice details", term: "IBT-023", path: "ProfileID", value: () => BUSINESS_PROCESS },
  { n: 8, name: "Specification identifier", section: "Invoice details", term: "IBT-024", path: "CustomizationID", value: () => SPECIFICATION_ID },
  { n: 9, name: "Payment means type code", section: "Invoice details", term: "IBT-081", path: "PaymentMeans/PaymentMeansCode", value: (c) => c.draft.payment_means },

  { n: 10, name: "Seller name", section: "Seller", term: "IBT-027", path: `${SUP}/PartyLegalEntity/RegistrationName`, value: (c) => c.seller.name },
  { n: 11, name: "Seller electronic address", section: "Seller", term: "IBT-034", path: `${SUP}/EndpointID`, value: (c) => tin(c.seller.trn) },
  { n: 12, name: "Seller electronic identifier", section: "Seller", term: "IBT-034-1", path: `${SUP}/EndpointID@schemeID`, value: (c) => (tin(c.seller.trn) ? ENDPOINT_SCHEME : null) },
  { n: 13, name: "Seller legal registration identifier", section: "Seller", term: "IBT-030", path: `${SUP}/PartyLegalEntity/CompanyID`, value: (c) => c.seller.legal_id },
  { n: 14, name: "Seller legal registration identifier type", section: "Seller", term: "BTAE-15", path: `${SUP}/PartyLegalEntity/CompanyID@schemeAgencyID`, value: (c) => c.seller.legal_id_type },
  { n: 15, name: "Seller tax identifier", section: "Seller", term: "IBT-031", path: `${SUP}/PartyTaxScheme/CompanyID`, value: (c) => c.seller.trn },
  { n: 16, name: "Seller tax scheme code", section: "Seller", term: "IBT-031-1", path: `${SUP}/PartyTaxScheme/TaxScheme/ID`, value: (c) => (c.seller.trn ? "VAT" : null) },
  { n: 17, name: "Seller address line 1", section: "Seller", term: "IBT-035", path: `${SUP}/PostalAddress/StreetName`, value: (c) => c.seller.address_line },
  { n: 18, name: "Seller city", section: "Seller", term: "IBT-037", path: `${SUP}/PostalAddress/CityName`, value: (c) => c.seller.city },
  { n: 19, name: "Seller country subdivision", section: "Seller", term: "IBT-039", path: `${SUP}/PostalAddress/CountrySubentity`, value: (c) => c.seller.subdivision },
  { n: 20, name: "Seller country code", section: "Seller", term: "IBT-040", path: `${SUP}/PostalAddress/Country/IdentificationCode`, value: (c) => c.seller.country },

  { n: 21, name: "Buyer name", section: "Buyer", term: "IBT-044", path: `${CUS}/PartyLegalEntity/RegistrationName`, value: (c) => c.buyer?.name ?? null },
  { n: 22, name: "Buyer electronic address", section: "Buyer", term: "IBT-049", path: `${CUS}/EndpointID`, value: (c) => tin(c.buyer?.trn ?? null) },
  { n: 23, name: "Buyer electronic identifier", section: "Buyer", term: "IBT-049-1", path: `${CUS}/EndpointID@schemeID`, value: (c) => (tin(c.buyer?.trn ?? null) ? ENDPOINT_SCHEME : null) },
  { n: 24, name: "Buyer tax identifier", section: "Buyer", term: "IBT-048", path: `${CUS}/PartyTaxScheme/CompanyID`, value: (c) => c.buyer?.trn ?? null },
  { n: 25, name: "Buyer tax scheme code", section: "Buyer", term: "IBT-048-1", path: `${CUS}/PartyTaxScheme/TaxScheme/ID`, value: (c) => (c.buyer?.trn ? "VAT" : null) },
  { n: 26, name: "Buyer address line 1", section: "Buyer", term: "IBT-050", path: `${CUS}/PostalAddress/StreetName`, value: (c) => c.buyer?.address_line ?? null },
  { n: 27, name: "Buyer city", section: "Buyer", term: "IBT-052", path: `${CUS}/PostalAddress/CityName`, value: (c) => c.buyer?.city ?? null },
  { n: 28, name: "Buyer country subdivision", section: "Buyer", term: "IBT-054", path: `${CUS}/PostalAddress/CountrySubentity`, value: (c) => c.buyer?.subdivision ?? null },
  { n: 29, name: "Buyer country code", section: "Buyer", term: "IBT-055", path: `${CUS}/PostalAddress/Country/IdentificationCode`, value: (c) => c.buyer?.country ?? null },

  { n: 30, name: "Sum of invoice line net amount", section: "Document totals", term: "IBT-106", path: "LegalMonetaryTotal/LineExtensionAmount", value: (c) => amount(c.line_total) },
  { n: 31, name: "Invoice total amount without tax", section: "Document totals", term: "IBT-109", path: "LegalMonetaryTotal/TaxExclusiveAmount", value: (c) => amount(c.tax_exclusive) },
  { n: 32, name: "Invoice total tax amount", section: "Document totals", term: "IBT-110", path: "TaxTotal/TaxAmount", value: (c) => amount(c.tax_total) },
  { n: 33, name: "Invoice total amount with tax", section: "Document totals", term: "IBT-112", path: "LegalMonetaryTotal/TaxInclusiveAmount", value: (c) => amount(c.tax_inclusive) },
  { n: 34, name: "Amount due for payment", section: "Document totals", term: "IBT-115", path: "LegalMonetaryTotal/PayableAmount", value: (c) => amount(c.payable) },

  { n: 35, name: "Tax category taxable amount", section: "Tax breakdown", term: "IBT-116", path: "TaxTotal/TaxSubtotal/TaxableAmount", value: (c) => (first(c) ? amount(first(c).taxable) : null) },
  { n: 36, name: "Tax category tax amount", section: "Tax breakdown", term: "IBT-117", path: "TaxTotal/TaxSubtotal/TaxAmount", value: (c) => (first(c) ? amount(first(c).tax) : null) },
  { n: 37, name: "Tax category code", section: "Tax breakdown", term: "IBT-118", path: "TaxTotal/TaxSubtotal/TaxCategory/ID", value: (c) => first(c)?.category ?? null },
  { n: 38, name: "Tax category rate", section: "Tax breakdown", term: "IBT-119", path: "TaxTotal/TaxSubtotal/TaxCategory/Percent", value: (c) => first(c)?.rate ?? null },

  { n: 39, name: "Invoice line identifier", section: "Invoice line", term: "IBT-126", path: "ID", value: (_c, l) => (l ? String(l.n) : null) },
  { n: 40, name: "Invoiced quantity", section: "Invoice line", term: "IBT-129", path: "InvoicedQuantity", value: (_c, l) => (l ? String(l.qty) : null) },
  { n: 41, name: "Unit of measure code", section: "Invoice line", term: "IBT-130", path: "InvoicedQuantity@unitCode", value: (_c, l) => l?.unit_code ?? null },
  { n: 42, name: "Invoice line net amount", section: "Invoice line", term: "IBT-131", path: "LineExtensionAmount", value: (_c, l) => (l ? amount(l.net) : null) },
  { n: 43, name: "Item net price", section: "Invoice line", term: "IBT-146", path: "Price/PriceAmount", value: (_c, l) => (l ? amount(l.price) : null) },
  { n: 44, name: "Item gross price", section: "Invoice line", term: "IBT-148", path: "Price/AllowanceCharge/BaseAmount", value: (_c, l) => (l ? amount(l.price) : null) },
  { n: 45, name: "Item price base quantity", section: "Invoice line", term: "IBT-149", path: "Price/BaseQuantity", value: (_c, l) => (l ? "1" : null) },
  { n: 46, name: "Invoiced item tax category code", section: "Invoice line", term: "IBT-151", path: "Item/ClassifiedTaxCategory/ID", value: (_c, l) => l?.tax_category ?? null },
  { n: 47, name: "Invoiced item tax rate", section: "Invoice line", term: "IBT-152", path: "Item/ClassifiedTaxCategory/Percent", value: (_c, l) => l?.tax_rate ?? null },
  { n: 48, name: "VAT line amount in AED", section: "Invoice line", term: "BTAE-08", path: "ItemPriceExtension/TaxTotal/TaxAmount", value: (_c, l) => (l ? amount(l.vat_aed) : null) },
  { n: 49, name: "Invoice line amount in AED", section: "Invoice line", term: "BTAE-10", path: "ItemPriceExtension/Amount", value: (_c, l) => (l ? amount(l.total_aed) : null) },
  { n: 50, name: "Item name", section: "Invoice line", term: "IBT-153", path: "Item/Name", value: (_c, l) => l?.name ?? null },
  { n: 51, name: "Item description", section: "Invoice line", term: "IBT-154", path: "Item/Description", value: (_c, l) => l?.description ?? null },
];

export const SECTIONS: Section[] = ["Invoice details", "Seller", "Buyer", "Document totals", "Tax breakdown", "Invoice line"];
