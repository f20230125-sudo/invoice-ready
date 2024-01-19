import { describe, expect, it } from "vitest";
import samplesJson from "../data/samples.json";
import { compute, tin } from "./compute";
import { FIELDS } from "./fields";
import { amount, percentOf, toFils } from "./money";
import { readBack } from "./readback";
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
      "Customer TRN 10031174020003 has 14 digits; a TRN has 15 and starts with 100. Without it there is no electronic address to send the invoice to.",
    );
  });

  it("fixing the customer record makes the invoice ready", () => {
    const awms = samples.invoices.find((d) => d.customer === "AWMS")!;
    const fixed = samples.customers.map((c) => (c.code === "AWMS" ? { ...c, trn: "100311740200003" } : c));
    expect(validate(run(awms, fixed))).toEqual([]);
  });
});

describe("the generated PINT AE XML", () => {
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
