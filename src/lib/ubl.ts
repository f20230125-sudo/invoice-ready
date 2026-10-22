import { amount } from "./money";
import { BUSINESS_PROCESS, ENDPOINT_SCHEME, SPECIFICATION_ID, tin, type Computed } from "./compute";
import type { Party } from "./types";

// Write the invoice as a PINT AE UBL 2.1 document, element by element as the syntax binding places them.

const NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

class Xml {
  private out: string[] = [];
  private depth = 0;
  open(tag: string, attrs: Record<string, string> = {}) {
    this.out.push(`${"  ".repeat(this.depth)}<${tag}${this.attrs(attrs)}>`);
    this.depth++;
    return this;
  }
  close(tag: string) {
    this.depth--;
    this.out.push(`${"  ".repeat(this.depth)}</${tag}>`);
    return this;
  }
  leaf(tag: string, value: string | null | undefined, attrs: Record<string, string> = {}) {
    if (value === null || value === undefined || value === "") return this; // optional data is simply left out
    this.out.push(`${"  ".repeat(this.depth)}<${tag}${this.attrs(attrs)}>${esc(value)}</${tag}>`);
    return this;
  }
  private attrs(a: Record<string, string>) {
    return Object.entries(a)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join("");
  }
  toString() {
    return this.out.join("\n");
  }
}

function party(x: Xml, wrapper: string, p: Party | null, name: string | null) {
  x.open(`cac:${wrapper}`).open("cac:Party");
  const endpoint = tin(p?.trn ?? null);
  if (endpoint) x.leaf("cbc:EndpointID", endpoint, { schemeID: ENDPOINT_SCHEME });
  x.open("cac:PostalAddress")
    .leaf("cbc:StreetName", p?.address_line)
    .leaf("cbc:CityName", p?.city)
    .leaf("cbc:CountrySubentity", p?.subdivision)
    .open("cac:Country")
    .leaf("cbc:IdentificationCode", p?.country)
    .close("cac:Country")
    .close("cac:PostalAddress");
  if (p?.trn) {
    x.open("cac:PartyTaxScheme").leaf("cbc:CompanyID", p.trn).open("cac:TaxScheme").leaf("cbc:ID", "VAT").close("cac:TaxScheme").close("cac:PartyTaxScheme");
  }
  x.open("cac:PartyLegalEntity").leaf("cbc:RegistrationName", name);
  // IBR-172-AE and IBR-101-AE: TL identifiers carry their issuing authority.
  if (p?.legal_id) x.leaf("cbc:CompanyID", p.legal_id, {
    schemeAgencyID: p.legal_id_type ?? "", schemeAgencyName: p.legal_id_type === "TL" ? p.legal_id_authority ?? "" : "",
  });
  x.close("cac:PartyLegalEntity").close("cac:Party").close(`cac:${wrapper}`);
}

export function toUbl(c: Computed): string {
  const d = c.draft;
  const cur = d.currency;
  const x = new Xml();
  x.open("Invoice", { xmlns: NS.inv, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc })
    .leaf("cbc:CustomizationID", SPECIFICATION_ID)
    .leaf("cbc:ProfileID", BUSINESS_PROCESS)
    .leaf("cbc:ProfileExecutionID", d.transaction_flags)
    .leaf("cbc:ID", d.id)
    .leaf("cbc:IssueDate", d.issue_date)
    .leaf("cbc:DueDate", d.due_date)
    .leaf("cbc:InvoiceTypeCode", d.type_code)
    .leaf("cbc:DocumentCurrencyCode", cur);
  // IBT-013: the buyer's purchase order belongs in OrderReference.
  if (d.customer_po) x.open("cac:OrderReference").leaf("cbc:ID", d.customer_po).close("cac:OrderReference");
  party(x, "AccountingSupplierParty", c.seller, c.seller.name);
  party(x, "AccountingCustomerParty", c.buyer, c.buyer?.name ?? null);
  // IBR-152-AE: serialize the export delivery address.
  if (d.delivery) {
    x.open("cac:Delivery").open("cac:DeliveryLocation").open("cac:Address")
      .leaf("cbc:StreetName", d.delivery.address_line)
      .leaf("cbc:CityName", d.delivery.city)
      .leaf("cbc:CountrySubentity", d.delivery.subdivision)
      .open("cac:Country").leaf("cbc:IdentificationCode", d.delivery.country).close("cac:Country")
      .close("cac:Address").close("cac:DeliveryLocation").close("cac:Delivery");
  }
  if (d.payment_means) x.open("cac:PaymentMeans").leaf("cbc:PaymentMeansCode", d.payment_means).close("cac:PaymentMeans");
  x.open("cac:TaxTotal").leaf("cbc:TaxAmount", amount(c.tax_total), { currencyID: cur });
  for (const g of c.subtotals) {
    x.open("cac:TaxSubtotal")
      .leaf("cbc:TaxableAmount", amount(g.taxable), { currencyID: cur })
      .leaf("cbc:TaxAmount", amount(g.tax), { currencyID: cur })
      .open("cac:TaxCategory")
      .leaf("cbc:ID", g.category)
      // ALIGNED-IBRP-O-11-AE: out-of-scope breakdowns must not carry a percentage.
      .leaf("cbc:Percent", g.category === "O" ? null : g.rate)
      .open("cac:TaxScheme")
      .leaf("cbc:ID", "VAT")
      .close("cac:TaxScheme")
      .close("cac:TaxCategory")
      .close("cac:TaxSubtotal");
  }
  x.close("cac:TaxTotal");
  x.open("cac:LegalMonetaryTotal")
    .leaf("cbc:LineExtensionAmount", amount(c.line_total), { currencyID: cur })
    .leaf("cbc:TaxExclusiveAmount", amount(c.tax_exclusive), { currencyID: cur })
    .leaf("cbc:TaxInclusiveAmount", amount(c.tax_inclusive), { currencyID: cur })
    .leaf("cbc:PayableAmount", amount(c.payable), { currencyID: cur })
    .close("cac:LegalMonetaryTotal");
  for (const l of c.lines) {
    x.open("cac:InvoiceLine")
      .leaf("cbc:ID", String(l.n))
      .leaf("cbc:InvoicedQuantity", Number.isFinite(l.qty) ? String(l.qty) : null, { unitCode: l.unit_code })
      .leaf("cbc:LineExtensionAmount", amount(l.net), { currencyID: cur })
      .open("cac:Item")
      .leaf("cbc:Description", l.description)
      .leaf("cbc:Name", l.name)
      .open("cac:SellersItemIdentification")
      .leaf("cbc:ID", l.part_number)
      .close("cac:SellersItemIdentification")
      .open("cac:ClassifiedTaxCategory")
      .leaf("cbc:ID", l.tax_category)
      // ALIGNED-IBRP-O-05: out-of-scope lines must not carry a percentage.
      .leaf("cbc:Percent", l.tax_category === "O" ? null : l.tax_rate)
      .open("cac:TaxScheme")
      .leaf("cbc:ID", "VAT")
      .close("cac:TaxScheme")
      .close("cac:ClassifiedTaxCategory")
      .close("cac:Item")
      .open("cac:Price")
      .leaf("cbc:PriceAmount", amount(l.price), { currencyID: cur })
      .leaf("cbc:BaseQuantity", "1", { unitCode: l.unit_code })
      .open("cac:AllowanceCharge")
      .leaf("cbc:ChargeIndicator", "false")
      .leaf("cbc:Amount", "0.00", { currencyID: cur })
      .leaf("cbc:BaseAmount", amount(l.price), { currencyID: cur })
      .close("cac:AllowanceCharge")
      .close("cac:Price")
      .open("cac:ItemPriceExtension")
      .leaf("cbc:Amount", amount(l.total_aed), { currencyID: "AED" })
      .open("cac:TaxTotal")
      .leaf("cbc:TaxAmount", amount(l.vat_aed), { currencyID: "AED" })
      .close("cac:TaxTotal")
      .close("cac:ItemPriceExtension")
      .close("cac:InvoiceLine");
  }
  x.close("Invoice");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${x.toString()}\n`;
}
