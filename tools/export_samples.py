"""Export sample invoices from Order Desk's synthetic orders (the ones delivered or handed to finance).

    PYTHONPATH=../order-desk ../order-desk/.venv/Scripts/python.exe tools/export_samples.py

Writes src/data/samples.json: the seller, the customers as their master data stands (with real-life gaps:
some have no trade licence number on file), and one draft invoice per delivered order.
"""

import json
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from synth.catalogue import CUSTOMERS, PRODUCT_BY_PART, US
from synth.scenario import build

OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "samples.json"

# Master data as a sales team usually has it: trade licence numbers missing for some customers.
LICENCES = {"AWMS": None, "SPA": "CD-2019-1147", "GCB": "TL-704512", "MCB": "TL-611903", "SPAC": None,
            "BAIS": "TL-882104", "DMC": "TL-905517", "QLG": "TL-447210"}
LICENCE_TYPE = {"SPA": "CD"}  # a government authority set up by Cabinet Decision
# IBR-128-AE: UAE country subdivisions use emirate codes.
EMIRATES = {"Abu Dhabi": "AUH", "Dubai": "DXB", "Sharjah": "SHJ", "Umm Al Quwain": "UAQ",
            "Fujairah": "FUJ", "Ajman": "AJM", "Ras Al Khaimah": "RAK"}
AUTHORITIES = {"GCB": "Abu Dhabi Department of Economic Development", "MCB": "Dubai Department of Economy and Tourism",
               "BAIS": "Dubai Department of Economy and Tourism", "DMC": "Abu Dhabi Department of Economic Development",
               "QLG": "Jebel Ali Free Zone Authority"}
# Gaps a real customer file has: a TRN typed with a digit missing, an address with no city.
TRN_TYPO = {"AWMS": "10031174020003"}
NO_CITY = {"SPAC"}


def money(x: Decimal) -> str:
    return f"{x.quantize(Decimal('0.01'))}"


def main() -> None:
    orders = [o for o in build() if o.stage in ("delivered", "ready_to_invoice")]
    customers = []
    for c in CUSTOMERS:
        customers.append({
            "code": c.short_code, "name": c.name, "trn": TRN_TYPO.get(c.short_code, c.trn), "sector": c.sector,
            "address_line": c.address, "city": None if c.short_code in NO_CITY else c.emirate,
            "subdivision": EMIRATES[c.emirate], "country": "AE",
            "legal_id": LICENCES[c.short_code], "legal_id_type": LICENCE_TYPE.get(c.short_code, "TL")
            if LICENCES[c.short_code] else None,
            "legal_id_authority": AUTHORITIES.get(c.short_code),  # IBR-101-AE
        })
    invoices = []
    for n, o in enumerate(orders, start=1):
        issue = o.customer_po.po_date + timedelta(days=sum(o.days_ago.values()) % 9 + 12)
        lines = []
        for ln in o.true_lines:
            prod = PRODUCT_BY_PART[ln.part_number]
            lines.append({"part_number": ln.part_number, "name": prod.description.split(",")[0],
                          "description": prod.description, "qty": ln.qty, "unit_price": money(ln.unit_price),
                          "unit_code": "H87" if prod.serialised else "C62", "tax_category": "S", "tax_rate": "5"})
        invoices.append({
            "id": f"INV-2026-{n:04d}", "issue_date": issue.isoformat(),
            "due_date": (issue + timedelta(days=30)).isoformat(), "currency": "AED",
            "customer": o.customer.short_code, "customer_po": o.customer_po.po_number,
            "type_code": "380", "transaction_flags": "00000000", "payment_means": "30", "lines": lines,
        })
    # One export to the customer's overseas warehouse, to show the zero rate and the exports flag.
    invoices.append({**invoices[0], "id": f"INV-2026-{len(invoices) + 1:04d}", "transaction_flags": "00000001",
                     "delivery": {"address_line": "Warehouse 6, Rusayl Industrial Estate", "city": "Muscat",
                                  "subdivision": "Muscat", "country": "OM"},  # IBR-152-AE
                     "lines": [{**ln, "tax_category": "Z", "tax_rate": "0"} for ln in invoices[0]["lines"]]})
    seller = {"name": US["name"], "trn": US["trn"], "legal_id": "DIC-104582", "legal_id_type": "TL",
              "legal_id_authority": "Dubai Development Authority",  # IBR-172-AE
              "address_line": "Office 214, Building 9, Dubai Internet City", "city": "Dubai", "subdivision": "DXB",
              "country": "AE"}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"seller": seller, "customers": customers, "invoices": invoices}, indent=1) + "\n",
                   encoding="utf-8", newline="\n")
    print(f"{len(invoices)} invoices, {len(customers)} customers -> {OUT}")


if __name__ == "__main__":
    main()
