import { DOMParser } from "@xmldom/xmldom";
import { FIELDS } from "./fields";
import { toFils } from "./money";

// Read the generated XML back, as a receiving system would: every mandatory field must be found at its UBL
// path, and the totals must add up by the PINT rules. This checks the generator itself, not the draft.

type El = { localName: string | null; childNodes: ArrayLike<unknown>; textContent: string | null; getAttribute(n: string): string | null; nodeType: number };

function children(el: El, name: string): El[] {
  const out: El[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as El;
    if (c.nodeType === 1 && c.localName === name) out.push(c);
  }
  return out;
}

/** All values at a path like "A/B/C" or "A/B@attr", below `root`. */
export function at(root: El, path: string): string[] {
  const [steps, attr] = path.split("@");
  let nodes = [root];
  for (const step of steps.split("/")) nodes = nodes.flatMap((n) => children(n, step));
  return nodes.map((n) => (attr ? n.getAttribute(attr) ?? "" : (n.textContent ?? "").trim())).filter((v) => v !== "");
}

export interface Readback {
  missing: { n: number; name: string; line?: number }[];
  sums: { rule: string; ok: boolean; text: string }[];
}

export function readBack(xml: string): Readback {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as El;
  const missing: Readback["missing"] = [];
  const lines = children(root, "InvoiceLine");
  for (const f of FIELDS) {
    if (f.section === "Invoice line") {
      lines.forEach((l, i) => at(l, f.path).length === 0 && missing.push({ n: f.n, name: f.name, line: i + 1 }));
    } else if (at(root, f.path).length === 0) {
      missing.push({ n: f.n, name: f.name });
    }
  }
  const one = (p: string) => toFils(at(root, p)[0] ?? "0");
  const lineNets = lines.reduce((s, l) => s + toFils(at(l, "LineExtensionAmount")[0] ?? "0"), 0);
  const subtotalTax = at(root, "TaxTotal/TaxSubtotal/TaxAmount").reduce((s, v) => s + toFils(v), 0);
  const ibt106 = one("LegalMonetaryTotal/LineExtensionAmount");
  const ibt109 = one("LegalMonetaryTotal/TaxExclusiveAmount");
  const ibt110 = one("TaxTotal/TaxAmount");
  const ibt112 = one("LegalMonetaryTotal/TaxInclusiveAmount");
  const ibt115 = one("LegalMonetaryTotal/PayableAmount");
  const sums = [
    { rule: "IBR-CO-10", ok: ibt106 === lineNets, text: "Sum of line net amounts = sum of the lines" },
    { rule: "IBR-CO-13", ok: ibt109 === ibt106, text: "Total without tax = line total (no document allowances or charges)" },
    { rule: "IBR-CO-14", ok: ibt110 === subtotalTax, text: "Total tax = sum of the tax category amounts" },
    { rule: "IBR-CO-15", ok: ibt112 === ibt109 + ibt110, text: "Total with tax = total without tax + total tax" },
    { rule: "IBR-CO-16", ok: ibt115 === ibt112, text: "Amount due = total with tax (nothing prepaid)" },
  ];
  return { missing, sums };
}
