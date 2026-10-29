import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402
from app import app  # noqa: E402

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "UP"


def test_model_quality():
    m = client.get("/model").json()
    assert m["roc_auc"] >= 0.85, m


def test_normal_invoice_scores_low():
    r = client.post("/score", json={"log_amount": 5.4, "line_count": 2, "days_po_to_invoice": 10,
                                    "vendor_age_days": 1500, "threshold_ratio": 0.25, "vendor_invoices_30d": 1}).json()
    assert r["anomalyScore"] < 0.5


def test_fraud_pattern_scores_high_and_explains():
    r = client.post("/score", json={"log_amount": 5.99, "amount_zscore": 6, "line_count": 1, "max_price_var_pct": 12,
                                    "qty_over_gr_ratio": 1.5, "days_po_to_invoice": 2, "vendor_age_days": 20,
                                    "threshold_ratio": 0.98, "vendor_invoices_30d": 3}).json()
    assert r["anomalyScore"] > 0.7 and r["isAnomaly"]
    assert r["topFactors"], r
