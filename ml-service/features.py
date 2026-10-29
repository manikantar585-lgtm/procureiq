"""Feature contract shared with the Node.js backend (srv/engine/risk-rules.js -> features())."""

FEATURES = [
    "log_amount",
    "amount_zscore",
    "line_count",
    "max_price_var_pct",
    "qty_over_gr_ratio",
    "days_po_to_invoice",
    "vendor_age_days",
    "threshold_ratio",
    "vendor_invoices_30d",
    "has_po",
]

FEATURE_LABELS = {
    "log_amount": "Invoice amount (magnitude)",
    "amount_zscore": "Amount vs vendor's usual invoices",
    "line_count": "Number of line items",
    "max_price_var_pct": "Price deviation from PO",
    "qty_over_gr_ratio": "Quantity billed beyond goods received",
    "days_po_to_invoice": "Days between PO and invoice",
    "vendor_age_days": "Vendor relationship age",
    "threshold_ratio": "Closeness to approval limit",
    "vendor_invoices_30d": "Invoice frequency (30 days)",
    "has_po": "Purchase order reference",
}


def to_vector(payload: dict) -> list[float]:
    return [float(payload.get(f, 0) or 0) for f in FEATURES]
