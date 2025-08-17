import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PencilRing, PencilTick } from "../components/Marks";
import { GO_LIVE, daysUntil, longDate } from "../lib/dates";
import { show } from "../lib/money";
import { useStore } from "../lib/store";
import type { Customer } from "../lib/types";
import { fieldStatus } from "../lib/validate";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function FixForm({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const { fixCustomer } = useStore();
  const [original] = useState(customer);
  const [trn, setTrn] = useState(customer.trn ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);
  return (
    <form
      className="fix"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Partial<Customer> = {};
        // Compare against the record when the form opened, even after another tab updates it.
        if (trn.trim() !== (original.trn ?? "")) patch.trn = trn.trim() || null;
        if (city.trim() !== (original.city ?? "")) patch.city = city.trim() || null;
        fixCustomer(customer.code, patch);
        onDone();
      }}
    >
      <label>
        <span id={`trn-label-${customer.code}`}>TRN</span>
        <input
          ref={firstInput}
          className="mono"
          value={trn}
          onChange={(e) => setTrn(e.target.value.replace(/\s/g, ""))}
          inputMode="numeric"
          maxLength={15}
          aria-labelledby={`trn-label-${customer.code}`}
          aria-describedby={`trn-help-${customer.code}`}
        />
        <span className="input-help" id={`trn-help-${customer.code}`}>
          15 digits, starts with 1, ends in 03.
        </span>
      </label>
      <label>
        <span>City</span>
        <input value={city} onChange={(e) => setCity(e.target.value)} />
      </label>
      <button type="submit" className="button primary">
        Save the record
      </button>
      <button type="button" className="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

export function Readiness() {
  const { checked, customers, fixed, resetFixes, original } = useStore();
  const navigate = useNavigate();
  const [fixing, setFixing] = useState<string | null>(null);
  const returnFocus = useRef<string | null>(null);
  // Restore focus after the record list updates, including when a corrected row disappears.
  useEffect(() => {
    const code = returnFocus.current;
    if (!code) return;
    returnFocus.current = null;
    const target = document.getElementById(`fix-${code}`)
      ?? document.querySelector<HTMLButtonElement>(".record-action")
      ?? document.getElementById("inv-h");
    target?.focus();
  });
  useEffect(() => {
    document.title = "Invoice Ready";
  }, []);

  const ready = checked.filter((x) => x.findings.length === 0);
  const held = checked.filter((x) => x.findings.length > 0);
  const records = useMemo(() => {
    const byCustomer = new Map<string, { customer: Customer; problems: Set<string>; invoices: number }>();
    for (const x of held) {
      for (const f of x.findings.filter((f) => f.where === "customer")) {
        const code = x.c.draft.customer;
        const entry = byCustomer.get(code) ?? { customer: customers.find((c) => c.code === code)!, problems: new Set(), invoices: 0 };
        entry.problems.add(f.message);
        byCustomer.set(code, entry);
      }
    }
    for (const x of held) {
      const e = byCustomer.get(x.c.draft.customer);
      if (e) e.invoices += 1;
    }
    return [...byCustomer.values()];
  }, [held, customers]);
  const fixedCount = Object.keys(fixed).length;

  return (
    <div className="page">
      <p className="caption">Demo with sample invoices</p>
      <h1>E-invoice readiness</h1>
      <p className="lede" role="status">
        {plural(checked.length, "draft invoice")}. {ready.length} {ready.length === 1 ? "is" : "are"} ready to send as UAE electronic invoices
        {held.length > 0 ? `; ${held.length} ${held.length === 1 ? "is" : "are"} held by ${plural(records.length, "customer record")} with gaps.` : "."}
      </p>
      <p className="next-step">
        {held.length > 0 ? "Start with the customer records below, then open an invoice to review its fields and XML." : "Open an invoice below to review its fields and download the XML."}
      </p>
      <details className="deadlines">
        <summary>E-invoicing deadlines</summary>
        <p className="golive">
          E-invoicing becomes mandatory on{" "}
          {GO_LIVE.map((g, i) => (
            <span key={g.date}>
              <strong>{longDate(g.date)}</strong> for {g.who} ({daysUntil(g.date)} days)
              {i < GO_LIVE.length - 2 ? ", " : i === GO_LIVE.length - 2 ? " and " : "."}
            </span>
          ))}{" "}
          <span className="quiet">Ministerial Decision 244 of 2025.</span>
        </p>
      </details>

      {records.length > 0 && (
        <section aria-labelledby="records-h">
          <h2 id="records-h">Customer records to fix first</h2>
          <p className="quiet">One wrong record holds every invoice to that customer. Fixes here are kept in this browser only.</p>
          <ul className="records">
            {records.map((r) => (
              <li key={r.customer.code}>
                <div className="record-head">
                  <PencilRing variant={r.customer.code.length}>{r.invoices}</PencilRing>
                  <div className="record-content">
                    <div>
                      <strong>{r.customer.name}</strong> <span className="quiet">holds {plural(r.invoices, "invoice")}</span>
                      {[...r.problems].map((p) => (
                        <p key={p}>{p}</p>
                      ))}
                      {original(r.customer.code)?.trn !== r.customer.trn && <p className="quiet small">Changed in this browser.</p>}
                    </div>
                    {fixing === r.customer.code ? (
                      <FixForm
                        key={r.customer.code}
                        customer={r.customer}
                        onDone={() => {
                          returnFocus.current = r.customer.code;
                          setFixing(null);
                        }}
                      />
                    ) : (
                      <button id={`fix-${r.customer.code}`} type="button" className="button record-action" onClick={() => setFixing(r.customer.code)}>
                        Fix the record
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {held.length === 0 && checked.length > 0 && (
        <p className="complete"><PencilTick /> No customer records need fixing. Every draft invoice is ready to review.</p>
      )}
      {fixedCount > 0 && (
        <p className="quiet small">
          {plural(fixedCount, "customer record")} corrected in this browser.{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              returnFocus.current = "reset";
              resetFixes();
            }}
          >
            Undo the corrections
          </button>
        </p>
      )}

      <section aria-labelledby="inv-h">
        <h2 id="inv-h" tabIndex={-1}>
          Invoices <span className="count">{checked.length}</span>
        </h2>
        <table className="pad invoice-list">
          <caption className="visually-hidden">Draft invoices with how many of the 51 mandatory fields they carry, and their first problem.</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Ready</span>
              </th>
              <th scope="col">Invoice</th>
              <th scope="col">Customer</th>
              <th scope="col" className="num">
                Total AED
              </th>
              <th scope="col">Mandatory fields</th>
              <th scope="col">First problem</th>
            </tr>
          </thead>
          <tbody>
            {checked.map(({ c, findings }) => {
              const okFields = [...fieldStatus(c, findings).values()].filter((s) => s === "ok").length;
              return (
                <tr key={c.draft.id} className="row" onClick={(e) => !(e.target as HTMLElement).closest("a") && navigate(`/invoices/${c.draft.id}`)}>
                  <td className="margin">
                    {findings.length ? (
                      <PencilRing variant={c.draft.id.length} label={plural(findings.length, "problem")}>
                        {findings.length}
                      </PencilRing>
                    ) : (
                      <PencilTick label="Ready" />
                    )}
                  </td>
                  <th scope="row">
                    <Link className="mono id" to={`/invoices/${c.draft.id}`}>
                      {c.draft.id}
                    </Link>
                    <span className="sub">PO {c.draft.customer_po}</span>
                  </th>
                  <td>
                    <span className="mobile-label" aria-hidden="true">Customer</span>
                    <div>
                      {c.buyer?.name}
                      {c.draft.transaction_flags[7] === "1" && <span className="sub">Export, zero-rated</span>}
                    </div>
                  </td>
                  <td className="num">
                    <span className="mobile-label" aria-hidden="true">Total AED</span>
                    {show(c.payable)}
                  </td>
                  <td>
                    <span className="mobile-label" aria-hidden="true">Fields</span>
                    {okFields} of 51
                  </td>
                  <td>
                    <span className="mobile-label" aria-hidden="true">First problem</span>
                    <span>{findings[0]?.message ?? <span className="quiet">None</span>}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
