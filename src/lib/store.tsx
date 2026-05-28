import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import samplesJson from "../data/samples.json";
import { compute, type Computed } from "./compute";
import type { Customer, Samples } from "./types";
import { validate, type Finding } from "./validate";

// The sample data, plus any customer records corrected in this browser (kept in localStorage only).

const KEY = "invoice-ready:customer-fixes";
const samples = samplesJson as Samples;

export interface Checked {
  c: Computed;
  findings: Finding[];
}

interface Store {
  customers: Customer[];
  checked: Checked[];
  fixed: Record<string, Partial<Customer>>;
  fixCustomer: (code: string, patch: Partial<Customer>) => void;
  resetFixes: () => void;
  original: (code: string) => Customer | undefined;
}

function load(): Record<string, Partial<Customer>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [fixed, setFixed] = useState(load);
  const save = (next: Record<string, Partial<Customer>>) => {
    setFixed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage blocked: the fix still holds for this visit
    }
  };
  const customers = useMemo(() => samples.customers.map((c) => ({ ...c, ...fixed[c.code] })), [fixed]);
  const checked = useMemo(
    () =>
      samples.invoices.map((d) => {
        const c = compute(d, samples.seller, customers);
        return { c, findings: validate(c) };
      }),
    [customers],
  );
  const fixCustomer = useCallback((code: string, patch: Partial<Customer>) => {
    const latest = { ...fixed, ...load() };
    save({ ...latest, [code]: { ...latest[code], ...patch } });
  }, [fixed]);
  const value: Store = {
    customers,
    checked,
    fixed,
    fixCustomer,
    resetFixes: () => save({}),
    original: (code) => samples.customers.find((c) => c.code === code),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

export const SELLER = samples.seller;
