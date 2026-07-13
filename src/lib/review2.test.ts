import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import samplesJson from "../data/samples.json";
import { compute } from "./compute";
import { at, readBack } from "./readback";
import type { InvoiceDraft, Line, Samples } from "./types";
import { fieldStatus, validate } from "./validate";
import { toUbl } from "./ubl";

const samples = samplesJson as Samples;
const clean = samples.invoices[0];
const run = (patch: Partial<InvoiceDraft> = {}, line: Partial<Line> = {}, customers = samples.customers) =>
  compute({ ...clean, ...patch, lines: patch.lines ?? [{ ...clean.lines[0], qty: 1, unit_price: "100.00", ...line }] }, samples.seller, customers);

describe("second-round review regressions", () => {
  it.each([[0.145, "1.00", 15], [0.285, "1.00", 29], [1.005, "1.00", 101], [5e-7, "10000.00", 1]])(
    "rounds decimal quantity %s at price %s half up to %s fils (IBR-147-AE)", (qty, unit_price, net) => {
      const c = run({}, { qty, unit_price });
      expect(c.lines[0].net).toBe(net);
      expect(validate(c)).toEqual([]);
      expect(readBack(toUbl(c)).sums.every((s) => s.ok)).toBe(true);
    },
  );

  it("accepts a 15-digit TRN starting with 1 and ending in 03 (IBR-132-AE)", () => {
    const customers = samples.customers.map((c) => ({ ...c, trn: "101000000000003" }));
    const c = run({}, {}, customers);
    expect(validate(c)).toEqual([]);
    expect(validate({ ...c, seller: { ...c.seller, trn: "101000000000003" } })).toEqual([]);
  });

  it("holds category N until its special VAT treatment is supported (IBR-108-AE)", () => {
    expect(validate(run({}, { tax_category: "N" }))).toContainEqual(expect.objectContaining({
      field: 46, line: 1, message: expect.stringMatching(/category N.*not supported/),
    }));
  });

  it("groups equivalent decimal rates before rounding category VAT (ALIGNED-IBRP-S-08)", () => {
    const lines = ["5", "5.0", "05.00"].map((tax_rate) => ({ ...clean.lines[0], qty: 1, unit_price: "0.10", tax_rate }));
    const c = run({ lines: lines.slice(0, 2) });
    expect(c.subtotals).toEqual([{ category: "S", rate: "5", taxable: 20, tax: 1 }]);
    expect(c.payable).toBe(21);
    expect(run({ lines }).subtotals).toEqual([{ category: "S", rate: "5", taxable: 30, tax: 2 }]);
    expect(readBack(toUbl(c)).sums.every((s) => s.ok)).toBe(true);
  });

  it("omits O percentages without marking inapplicable rates missing (ALIGNED-IBRP-O-05/11-AE)", () => {
    const c = run({ type_code: "480" }, { tax_category: "O", tax_rate: "" });
    expect(validate(c)).toEqual([]);
    const xml = toUbl(c);
    expect(xml).not.toContain("cbc:Percent");
    expect(readBack(xml).missing).toEqual([]);
    expect([...fieldStatus(c, []).values()].every((s) => s === "ok")).toBe(true);
    const zero = toUbl(run({ type_code: "480" }, { tax_category: "O", tax_rate: "0" }));
    expect(zero).not.toContain("cbc:Percent");
    const outOfScope = run({ type_code: "480", lines: ["", "0"].map((tax_rate) => ({ ...clean.lines[0], tax_category: "O", tax_rate })) });
    expect(outOfScope.subtotals).toHaveLength(1);
    expect(validate(outOfScope)).toEqual([]);
    const mixed = run({ lines: [{ ...clean.lines[0], tax_category: "O", tax_rate: "" }, clean.lines[0]] });
    const root = new DOMParser().parseFromString(toUbl(mixed), "text/xml").documentElement!;
    expect(at(root, "InvoiceLine/Item/ClassifiedTaxCategory/Percent")).toEqual(["5"]);
    expect(at(root, "TaxTotal/TaxSubtotal/TaxCategory/Percent")).toEqual(["5"]);
    expect(readBack(toUbl(mixed)).missing).toEqual([]);
    const missingRate = toUbl(mixed).replace(/\s*<cbc:Percent>5<\/cbc:Percent>/g, "");
    expect(readBack(missingRate).missing.map((f) => f.n)).toContain(38);
    expect(readBack(missingRate).missing).toContainEqual(expect.objectContaining({ n: 47, line: 2 }));
  });

  it("holds reverse charge until item classification and scheme 0160 are supported (IBR-166/174-AE)", () => {
    expect(validate(run({}, { tax_category: "AE" }))).toContainEqual(expect.objectContaining({
      field: 46, line: 1, message: expect.stringMatching(/reverse charge.*classification.*0160.*not supported/),
    }));
  });

  it.each(["USD", "EUR", "ZZZ"])("holds currency %s until exchange rates are supported (IBR-159-AE)", (currency) => {
    expect(validate(run({ currency }))).toContainEqual(expect.objectContaining({
      field: 4, message: expect.stringMatching(/only AED.*exchange rates.*not supported/),
    }));
  });

  it.each(["10000000", "01000000", "00100000", "00010000", "00001000", "00000100", "00000010"])(
    "holds transaction flags %s until dependent fields are supported", (transaction_flags) => {
      expect(validate(run({ transaction_flags }))).toContainEqual(expect.objectContaining({
        field: 5, message: expect.stringMatching(/not supported/),
      }));
    },
  );

  it.each([
    { legal_id: null, legal_id_type: null },
    { legal_id: "", legal_id_type: "TL" as const },
    { legal_id: "  ", legal_id_type: "TL" as const },
    { legal_id: "123", legal_id_type: null },
  ])("requires buyer registration and its type for 480 (IBR-136/180-AE): %j", (patch) => {
    const customers = samples.customers.map((c) => ({ ...c, ...patch }));
    expect(validate(run({ type_code: "480" }, { tax_category: "Z", tax_rate: "0" }, customers)))
      .toContainEqual(expect.objectContaining({ where: "customer", message: expect.stringMatching(/legal registration/) }));
  });

  it.each([
    { country: "AE", subdivision: "Dubai" },
    { country: "AE", subdivision: null },
    { country: null, subdivision: "DXB" },
    { country: "ZZ", subdivision: "DXB" },
  ])("validates every supplied delivery address (IBR-057/128-AE): %j", (patch) => {
    const delivery = { address_line: "A", city: "Dubai", ...patch };
    expect(validate(run({ delivery }))).toContainEqual(expect.objectContaining({
      where: "invoice", message: expect.stringMatching(/delivery/i),
    }));
  });

  it.each([NaN, Infinity, -Infinity])("holds quantity %s without breaking invoice XML or read-back", (qty) => {
    const c = run({}, { qty });
    expect(validate(c)).toContainEqual(expect.objectContaining({ field: 40, line: 1 }));
    expect(Number.isFinite(c.payable)).toBe(true);
    const xml = toUbl(c);
    expect(xml).not.toMatch(/NaN|Infinity/);
    expect(() => readBack(xml)).not.toThrow();
    expect(readBack(xml).missing).toContainEqual(expect.objectContaining({ n: 40, line: 1 }));
  });

  it.each([Number.MAX_VALUE, 1e20])("holds an unrepresentable line net for quantity %s without serializing invalid amounts", (qty) => {
    const c = run({}, { qty });
    expect(validate(c)).toContainEqual(expect.objectContaining({ field: 42, line: 1 }));
    expect(Number.isSafeInteger(c.payable)).toBe(true);
    expect(() => readBack(toUbl(c))).not.toThrow();
  });

  it("checks actual Rec 20/21 unit membership (IBR-CL-23)", () => {
    for (const unit_code of ["ZZZ", "AAA", "XZZZ", "h87"]) {
      expect(validate(run({}, { unit_code }))).toContainEqual(expect.objectContaining({ field: 41, line: 1 }));
    }
    for (const unit_code of ["H87", "C62", "KGM", "LTR", "HUR", "XBX", "X1A", "XZZ"]) {
      expect(validate(run({}, { unit_code }))).toEqual([]);
    }
  });
});
