import { BrowserRouter, Link, Outlet, Route, Routes } from "react-router";
import { StoreProvider } from "./lib/store";
import { Invoice } from "./pages/Invoice";
import { Readiness } from "./pages/Readiness";

function Layout() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to the content
      </a>
      <header className="top">
        <div className="top-inner">
          <Link to="/" className="wordmark">
            Invoice Ready
          </Link>
          <span className="tagline">UAE e-invoicing (PINT AE) check for finance</span>
          <a className="top-link" href="https://order-desk-ops.vercel.app">
            Order Desk
          </a>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="foot">
        A working demo with made-up companies and invoices. Rules from the UAE Ministry of Finance's mandatory field list
        (23 February 2026) and the Peppol PINT AE specification. Built by Uzair Khan.
      </footer>
    </>
  );
}

function NotFound() {
  return (
    <div className="page">
      <h1>Nothing at this address</h1>
      <Link className="button" to="/">
        Back to readiness
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Readiness />} />
            <Route path="/invoices/:id" element={<Invoice />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
