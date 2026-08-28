import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { PencilRing, PencilTick } from "../components/Marks";
import { FIELDS, requiredField, SECTIONS } from "../lib/fields";
import { show } from "../lib/money";
import { readBack } from "../lib/readback";
import { useStore } from "../lib/store";
import { toUbl } from "../lib/ubl";
import { fieldStatus } from "../lib/validate";

const WHERE = { invoice: "On the invoice", customer: "In the customer record", company: "In our company record" } as const;

export function Invoice() {
  const { id } = useParams();
  const { checked } = useStore();
  const found = checked.find((x) => x.c.draft.id === id);
  const [showXml, setShowXml] = useState(false);
  const xml = useMemo(() => (found ? toUbl(found.c) : ""), [found]);
  const back = useMemo(() => (xml ? readBack(xml) : null), [xml]);
  useEffect(() => {
    document.title = `${id}: Invoice Ready`;
  }, [id]);

  if (!found || !back) {
    return (
      <div className="page">
        <Link to="/" className="back">
          Readiness
        </Link>
        <h1>No such invoice</h1>
        <p className="lede">This invoice is not in the demo. Return to readiness to choose a sample invoice.</p>
      </div>
    );
  }
  const { c, findings } = found;
  const status = fieldStatus(c, findings);
  const ok = [...status.values()].filter((s) => s === "ok").length;
  const ready = findings.length === 0;
  const download = () => {
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${c.draft.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const valueOf = (n: number) => {
    const f = FIELDS[n - 1];
    if (!requiredField(n, f.section === "Invoice line" ? c.lines[0]?.tax_category : c.subtotals[0]?.category)) return "Not applicable";
    return f.section === "Invoice line" ? (c.lines[0] ? f.value(c, c.lines[0]) : null) : f.value(c);
  };

  return (
    <div className="page">
      <Link to="/" className="back">
        Readiness
      </Link>
      <p className="caption">Draft invoice</p>
      <h1 className="mono big">{c.draft.id}</h1>
      <p className="lede">
        {ready
          ? `Ready: all 51 mandatory fields are present and valid. Read back from the XML: ${51 - back.missing.length} of 51 fields found, ${back.sums.filter((s) => s.ok).length} of ${back.sums.length} sum rules hold.`
          : `${findings.length === 1 ? "One problem holds" : `${findings.length} problems hold`} this invoice: ${ok} of 51 mandatory fields are present and valid.`}
      </p>

      <div className="inv-grid">
        <div>
          {!ready && (
            <section aria-labelledby="prob-h" className="problems">
              <h2 id="prob-h">What to fix</h2>
              <ul>
                {findings.map((f, i) => (
                  <li key={i}>
                    <PencilRing variant={i}>{f.field}</PencilRing>
                    <div>
                      <p>{f.message}</p>
                      <p className="quiet small">
                        {WHERE[f.where]}. Field {f.field}, {FIELDS[f.field - 1].name.toLowerCase()} ({FIELDS[f.field - 1].term}).
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {findings.some((f) => f.where === "customer") && (
                <Link to="/" className="button">
                  Fix the customer record
                </Link>
              )}
            </section>
          )}

          <section aria-labelledby="doc-h" className="paper">
            <h2 id="doc-h" className="visually-hidden">
              The invoice
            </h2>
            <div className="parties">
              <div>
                <p className="caption">From</p>
                <strong>{c.seller.name}</strong>
                <p>{c.seller.address_line}</p>
                <p className="mono small">TRN {c.seller.trn}</p>
              </div>
              <div>
                <p className="caption">To</p>
                <strong>{c.buyer?.name}</strong>
                <p>
                  {c.buyer?.address_line}
                  {c.buyer?.city ? `, ${c.buyer.city}` : ""}
                </p>
                <p className="mono small">TRN {c.buyer?.trn ?? "none on file"}</p>
              </div>
              <div>
                <p className="caption">Dates</p>
                <p>Issued {c.draft.issue_date}</p>
                <p>Due {c.draft.due_date}</p>
                <p className="small">Their PO {c.draft.customer_po}</p>
              </div>
            </div>
            <table className="pad lines">
              <caption className="visually-hidden">Invoice items, quantities, prices, VAT and totals in {c.draft.currency}.</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    Qty
                  </th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col">VAT</th>
                  <th scope="col" className="num">
                    Net {c.draft.currency}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.n}>
                    <th scope="row">
                      <span className="mono small">{l.part_number}</span>
                      <span className="sub">{l.description}</span>
                    </th>
                    <td className="num">
                      <span className="mobile-label" aria-hidden="true">Qty</span>
                      <span>{l.qty} <span className="quiet small">{l.unit_code}</span></span>
                    </td>
                    <td className="num">
                      <span className="mobile-label" aria-hidden="true">Price {c.draft.currency}</span>
                      {show(l.price)}
                    </td>
                    <td className="nowrap">
                      <span className="mobile-label" aria-hidden="true">VAT</span>
                      <span>
                        {l.tax_category}{l.tax_category === "O" ? "" : ` ${l.tax_rate}%`}
                      </span>
                    </td>
                    <td className="num">
                      <span className="mobile-label" aria-hidden="true">Net {c.draft.currency}</span>
                      {show(l.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {c.subtotals.map((g) => (
                  <tr key={g.category + g.rate}>
                    <th scope="row" colSpan={4}>
                      VAT {g.category}{g.category === "O" ? "" : ` at ${g.rate}%`} on {show(g.taxable)}
                    </th>
                    <td className="num">{show(g.tax)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <th scope="row" colSpan={4}>
                    Amount due {c.draft.currency}
                  </th>
                  <td className="num">{show(c.payable)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section aria-labelledby="xml-h">
            <h2 id="xml-h">The electronic invoice</h2>
            <p>
              PINT AE, UBL 2.1. {ready ? "Read back after writing: every mandatory field found at its place, and the totals hold." : "It can be written now, but it is not valid until the problems above are fixed."}
            </p>
            <ul className="sums">
              {back.sums.map((s) => (
                <li key={s.rule}>
                  {s.ok ? <PencilTick label="holds" /> : <PencilRing label="fails" />} <span className="mono small">{s.rule}</span> <span>{s.text}</span>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button type="button" className={`button${ready ? " primary" : ""}`} onClick={download}>
                {ready ? "Download the XML" : "Download the draft XML"}
              </button>
              <button type="button" className="button" aria-expanded={showXml} aria-controls="invoice-xml" onClick={() => setShowXml((s) => !s)}>
                {showXml ? "Hide the XML" : "Show the XML"}
              </button>
            </div>
            <pre id="invoice-xml" className="xml" hidden={!showXml} tabIndex={0} aria-label="The invoice XML">
              {xml}
            </pre>
          </section>
        </div>

        <aside aria-labelledby="fields-h" className="fields" tabIndex={0}>
          <h2 id="fields-h">
            Mandatory fields <span className="count">{ok} of 51</span>
          </h2>
          <p className="quiet small">As listed by the Ministry of Finance, 23 February 2026. Line fields shown for line 1. Scroll this list to review all 51 fields.</p>
          {SECTIONS.map((sec) => (
            <div key={sec}>
              <h3>{sec}</h3>
              <ol>
                {FIELDS.filter((f) => f.section === sec).map((f) => (
                  <li key={f.n} className={status.get(f.n) === "ok" ? "" : "bad"}>
                    <span className="field-n">{f.n}</span>
                    <span className="field-name">{f.name}</span>
                    <span className="field-value mono">{valueOf(f.n) ?? (status.get(f.n) === "ok" ? "" : "missing")}</span>
                    <span className="field-mark">{status.get(f.n) === "ok" ? <PencilTick label="present" /> : <PencilRing label="problem" />}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
