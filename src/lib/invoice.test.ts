import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import samplesJson from "../data/samples.json";
import { compute, tin } from "./compute";
import { FIELDS } from "./fields";
import { amount, percentOf, toFils } from "./money";
import { at, readBack } from "./readback";
import type { InvoiceDraft, Samples } from "./types";
import { fieldStatus, validate } from "./validate";
import { toUbl } from "./ubl";

const samples = samplesJson as Samples;
const run = (d: InvoiceDraft, customers = samples.customers, seller = samples.seller) => compute(d, seller, customers);
const clean = samples.invoices.find((d) => validate(run(d)).length === 0)!;

describe("money", () => {
  it("adds in fils, never floats", () => {
    expect(toFils("0.10") + toFils("0.20")).toBe(30);
    expect(amount(toFils("1234.5"))).toBe("1234.50");
    expect(amount(-5)).toBe("-0.05");
    expect(percentOf(toFils("19.99"), "5")).toBe(100); // 0.9995 rounds half up to 1.00
    expect(() => toFils("1,000.00")).toThrow();
  });
});

describe("the Ministry's field list", () => {
  it("has the 51 mandatory fields of a tax invoice, numbered 1 to 51", () => {
    expect(FIELDS.map((f) => f.n)).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
  });
  it("forms the electronic address from the first 10 digits of the TRN", () => {
    expect(tin("100458213900003")).toBe("1004582139");
    expect(tin("10031174020003")).toBeNull();
  });
});

describe("the sample invoices", () => {
  it("9 are ready; 5 are held by customer records with gaps", () => {
    const results = samples.invoices.map((d) => validate(run(d)));
    expect(results.filter((r) => r.length === 0)).toHaveLength(9);
    const held = results.filter((r) => r.length > 0);
    expect(held).toHaveLength(5);
    expect(held.every((r) => r.every((f) => f.where === "customer"))).toBe(true);
  });

  it("explains a TRN typed with a digit missing", () => {
    const awms = samples.invoices.find((d) => d.customer === "AWMS")!;
    const msgs = validate(run(awms)).map((f) => f.message);
    expect(msgs).toContain(
      "Customer TRN 10031174020003 has 14 digits; a TRN has 15 digits, starts with 100 and ends in 03. Without it there is no electronic address to send the invoice to.",
    );
  });

  it("holds a 15-digit TRN that does not end in 03 (IBR-132-AE)", () => {
    const awms = samples.invoices.find((d) => d.customer === "AWMS")!;
    const wrong = samples.customers.map((c) => (c.code === "AWMS" ? { ...c, trn: "100311740200004" } : c));
    expect(validate(run(awms, wrong)).map((f) => f.message)).toContain(
      "Customer TRN 100311740200004 is 15 digits but does not start with 100 and end in 03; a TRN has 15 digits, starts with 100 and ends in 03. Without it there is no electronic address to send the invoice to.",
    );
  });

  it("fixing the customer record makes the invoice ready", () => {
    const awms = samples.invoices.find((d) => d.customer === "AWMS")!;
    const fixed = samples.customers.map((c) => (c.code === "AWMS" ? { ...c, trn: "100311740200003" } : c));
    expect(validate(run(awms, fixed))).toEqual([]);
  });
});

describe("the generated PINT AE XML", () => {
  it("writes permitted emirate codes for every UAE party", () => {
    for (const d of samples.invoices) {
      const root = new DOMParser().parseFromString(toUbl(run(d)), "text/xml").documentElement!;
      for (const party of ["AccountingSupplierParty", "AccountingCustomerParty"]) {
        expect(at(root, `${party}/Party/PostalAddress/CountrySubentity`)[0]).toMatch(/^(AUH|DXB|SHJ|UAQ|FUJ|AJM|RAK)$/);
      }
    }
  });

  it("writes the issuing authority for seller and buyer trade licences", () => {
    const c = run(clean);
    const root = new DOMParser().parseFromString(toUbl(c), "text/xml").documentElement!;
    expect(at(root, "AccountingSupplierParty/Party/PartyLegalEntity/CompanyID@schemeAgencyName")[0]).toBeTruthy();
    expect(at(root, "AccountingCustomerParty/Party/PartyLegalEntity/CompanyID@schemeAgencyName")[0]).toBeTruthy();
  });

  it("writes an export delivery address at its UBL path", () => {
    const exp = samples.invoices.find((d) => d.transaction_flags === "00000001")!;
    const root = new DOMParser().parseFromString(toUbl(run(exp)), "text/xml").documentElement!;
    const path = "Delivery/DeliveryLocation/Address";
    expect(at(root, `${path}/StreetName`)).toEqual(["Warehouse 6, Rusayl Industrial Estate"]);
    expect(at(root, `${path}/CityName`)).toEqual(["Muscat"]);
    expect(at(root, `${path}/CountrySubentity`)).toEqual(["Muscat"]);
    expect(at(root, `${path}/Country/IdentificationCode`)).toEqual(["OM"]);
  });

  it("writes a purchase order as an order reference", () => {
    const root = new DOMParser().parseFromString(toUbl(run(clean)), "text/xml").documentElement!;
    expect(at(root, "OrderReference/ID")).toEqual([clean.customer_po]);
    expect(at(root, "BuyerReference")).toEqual([]);
    const noPo = { ...clean, customer_po: "" };
    expect(toUbl(run(noPo))).not.toContain("cac:OrderReference");
  });

  it("carries all 51 mandatory fields and its totals add up", () => {
    const c = run(clean);
    const back = readBack(toUbl(c));
    expect(back.missing).toEqual([]);
    expect(back.sums.filter((s) => !s.ok)).toEqual([]);
    expect([...fieldStatus(c, []).values()].every((s) => s === "ok")).toBe(true);
  });

  it("uses the UAE identifiers", () => {
    const xml = toUbl(run(clean));
    expect(xml).toContain("<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0235">1004582139</cbc:EndpointID>');
    expect(xml).toContain("<cbc:ProfileExecutionID>00000000</cbc:ProfileExecutionID>");
  });

  it("leaves out what is missing, and the read-back notices", () => {
    const spac = samples.invoices.find((d) => d.customer === "SPAC")!;
    const back = readBack(toUbl(run(spac)));
    expect(back.missing.map((m) => m.n)).toEqual([27]); // buyer city
  });

  it("escapes text", () => {
    const d = { ...clean, lines: [{ ...clean.lines[0], description: 'Rack & "rails" <2U>' }] };
    expect(toUbl(run(d))).toContain("Rack &amp; &quot;rails&quot; &lt;2U&gt;");
  });
});

describe("rules", () => {
  const broken = (patch: Partial<InvoiceDraft>) => validate(run({ ...clean, ...patch })).map((f) => f.message);

  it("requires a permitted emirate code for UAE seller and buyer addresses", () => {
    const customers = samples.customers.map((c) => c.code === clean.customer ? { ...c, subdivision: "Abu Dhabi" } : c);
    const findings = validate(run(clean, customers, { ...samples.seller, subdivision: "Dubai" }));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 19, where: "company" }),
      expect.objectContaining({ field: 28, where: "customer" }),
    ]));
    for (const subdivision of ["AUH", "DXB", "SHJ", "UAQ", "FUJ", "AJM", "RAK"]) {
      expect(validate(run(clean, samples.customers, { ...samples.seller, subdivision }))).toEqual([]);
    }
    expect(validate(run(clean, samples.customers, { ...samples.seller, country: "OM", subdivision: "Muscat" }))).toEqual([]);
  });

  it("requires the issuing authority when a seller or buyer uses a trade licence", () => {
    const seller = { ...samples.seller, legal_id_authority: null };
    const customers = samples.customers.map((c) => ({ ...c, legal_id_authority: null }));
    const findings = validate(run(clean, customers, seller)).filter((f) => f.message.includes("issuing authority"));
    expect(findings.map((f) => f.where)).toEqual(["company", "customer"]);
    const cabinet = { ...seller, legal_id_type: "CD" as const };
    expect(validate(run(clean, samples.customers, cabinet))).toEqual([]);
  });

  it("reverse charge contributes zero VAT to lines, subtotals and payable", () => {
    const c = run({ ...clean, lines: [{ ...clean.lines[0], qty: 1, unit_price: "100.00", tax_category: "AE", tax_rate: "5" }] });
    expect(c.lines[0].vat_aed).toBe(0);
    expect(c.lines[0].total_aed).toBe(10000);
    expect(c.subtotals[0].tax).toBe(0);
    expect(c.tax_total).toBe(0);
    expect(c.payable).toBe(10000);
    expect(readBack(toUbl(c)).sums.every((s) => s.ok)).toBe(true);
  });

  it("rounds fractional quantities to whole fils before VAT and XML read-back", () => {
    const c = run({ ...clean, lines: [{ ...clean.lines[0], qty: 0.5, unit_price: "0.01" }] });
    expect(c.lines[0].net).toBe(1);
    expect(c.line_total).toBe(1);
    expect(c.payable).toBe(1);
    expect(readBack(toUbl(c)).sums.every((s) => s.ok)).toBe(true);
  });

  it.each(["oops", "NaN", "Infinity", "", " ", "0x5", "1e2", "9".repeat(400)])("holds malformed rate %j without breaking read-back", (tax_rate) => {
    for (const tax_category of ["S", "AE"] as const) {
      const c = run({ ...clean, lines: [{ ...clean.lines[0], tax_category, tax_rate }] });
      expect(validate(c)).toEqual(expect.arrayContaining([expect.objectContaining({ field: 47, line: 1 })]));
      expect(Number.isFinite(c.tax_total)).toBe(true);
      expect(Number.isFinite(c.lines[0].vat_aed)).toBe(true);
      expect(() => readBack(toUbl(c))).not.toThrow();
    }
  });

  it("holds exports with absent, incomplete or domestic delivery addresses", () => {
    const exp = samples.invoices.find((d) => d.transaction_flags === "00000001")!;
    const delivery = { address_line: "Warehouse 6, Rusayl Industrial Estate", city: "Muscat", subdivision: "Muscat", country: "OM" };
    const drafts = [
      { ...exp, delivery: undefined },
      ...Object.keys(delivery).map((key) => ({ ...exp, delivery: { ...delivery, [key]: null } })),
      { ...exp, delivery: { ...delivery, country: "AE" } },
      { ...exp, delivery: { ...delivery, country: "ZZ" } },
    ];
    for (const d of drafts) expect(validate(run(d))).toEqual(expect.arrayContaining([
      expect.objectContaining({ where: "invoice", message: expect.stringMatching(/delivery/i) }),
    ]));
  });

  it("holds exempt lines until exemption reasons and category-specific XML are supported", () => {
    expect(broken({ lines: [...clean.lines, { ...clean.lines[0], tax_category: "E", tax_rate: "0" }] }))
      .toContain(`Line ${clean.lines.length + 1}: exempt VAT (E) needs an exemption reason and category-specific XML, which are not supported yet.`);
  });

  it("out-of-scope invoices reject standard, reverse-charge and deemed-supply categories", () => {
    for (const tax_category of ["S", "AE", "N"] as const) {
      expect(broken({ type_code: "480", lines: [{ ...clean.lines[0], tax_category }] }).some((m) => m.includes("480"))).toBe(true);
    }
    for (const tax_category of ["O", "Z"] as const) {
      expect(broken({ type_code: "480", lines: [{ ...clean.lines[0], tax_category, tax_rate: "0" }] })).toEqual([]);
    }
  });

  it("checks payment means against the UAE list", () => {
    for (const payment_means of ["999", "2", "ZZZ"]) expect(broken({ payment_means }).some((m) => m.includes("Payment means"))).toBe(true);
    for (const payment_means of ["1", "10", "20", "21", "30", "49", "54", "55", "68"]) expect(broken({ payment_means })).toEqual([]);
  });

  it("checks seller and buyer country membership, including Peppol's additional codes", () => {
    const customers = samples.customers.map((c) => c.code === clean.customer ? { ...c, country: "ZZ" } : c);
    const findings = validate(run(clean, customers, { ...samples.seller, country: "ZZ" }));
    expect(findings.map((f) => f.field)).toEqual([20, 29]);
    for (const country of ["AE", "OM", "GB", "US", "1A", "XI"]) {
      expect(validate(run(clean, samples.customers, { ...samples.seller, country }))).toEqual([]);
    }
  });

  it("standard rate is 5%", () => {
    expect(broken({ lines: [{ ...clean.lines[0], tax_rate: "10" }] })).toContain("Line 1: standard rate (S) is 5% in the UAE, not 10%.");
  });
  it("an export charging VAT is flagged", () => {
    expect(broken({ transaction_flags: "00000001" }).some((m) => m.includes("flagged as an export"))).toBe(true);
  });
  it("the zero-rated export sample passes", () => {
    const exp = samples.invoices.find((d) => d.transaction_flags === "00000001")!;
    expect(validate(run(exp))).toEqual([]);
  });
  it("transaction type is 8 positions of 0 or 1", () => {
    expect(broken({ transaction_flags: "0001" })[0]).toMatch(/8 positions/);
  });
  it("dates are real and payment is not due before the invoice", () => {
    expect(broken({ issue_date: "2026-02-30" })[0]).toMatch(/not a real date/);
    expect(broken({ due_date: "2020-01-01" })[0]).toMatch(/before the invoice is issued/);
  });
  it("invoice type is 380 or 480", () => {
    expect(broken({ type_code: "381" })[0]).toMatch(/380/);
  });
});
