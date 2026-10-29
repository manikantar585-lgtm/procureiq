"""
Train the invoice anomaly model.

Hybrid ensemble:
  * IsolationForest (unsupervised)  - learns what "normal" approved invoices look like and
                                      catches novel patterns nobody has labelled yet.
  * HistGradientBoosting (supervised) - learns from invoices that auditors previously
                                      confirmed as fraud / error (audit labels).
Final score = 0.4 * calibrated isolation score + 0.6 * classifier probability.

NOTE: the demo trains on synthetic data that mimics an Indian manufacturer's AP history.
Replace synth_* with an extract of your SAP RBKP/RSEG + audit outcomes for production.

    python train.py            # trains and writes model/model.joblib + model/metrics.json
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import precision_score, recall_score, roc_auc_score, f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ensemble import Ensemble
from features import FEATURES

MODEL_DIR = Path(__file__).parent / "model"
SEED = 42


def synth_normal(n: int, rng: np.random.Generator) -> np.ndarray:
    amount = rng.lognormal(mean=12.4, sigma=0.9, size=n)            # ~ INR 2.4 lakh median
    amount = np.clip(amount, 5_000, 2_500_000)
    return np.column_stack([
        np.log10(amount),
        rng.normal(0, 1, n).clip(-3, 3),                              # amount z-score vs vendor
        rng.integers(1, 5, n),                                        # line count
        rng.normal(0, 0.6, n).clip(-2, 2),                            # price variance %
        np.where(rng.random(n) < 0.05, rng.uniform(0, 0.05, n), 0),   # qty over GR (rounding noise)
        rng.integers(3, 30, n),                                       # days PO -> invoice
        rng.integers(200, 3000, n),                                   # vendor age
        amount * 1.0 / 1_000_000,                                     # threshold ratio
        rng.poisson(1.2, n),                                          # invoices in 30d
        (rng.random(n) > 0.02).astype(float),                         # has PO (2% legit non-PO)
    ])


def synth_anomalies(n: int, rng: np.random.Generator, subtle: bool = False) -> np.ndarray:
    """subtle=True draws milder fraud for evaluation, so metrics are not trivially perfect."""
    f = 0.45 if subtle else 1.0
    base = synth_normal(n, rng)
    kinds = rng.integers(0, 6, n)
    for i, k in enumerate(kinds):
        if k == 0:   # price inflation
            base[i, 3] = rng.uniform(6, 30) * f + (2.5 if subtle else 0)
        elif k == 1: # billing for goods not received
            base[i, 4] = rng.uniform(0.3, 3) * f
        elif k == 2: # new vendor + just-under-threshold
            base[i, 6] = rng.integers(1, 60) if not subtle else rng.integers(30, 220); base[i, 7] = rng.uniform(0.95, 0.999); base[i, 0] = np.log10(base[i, 7] * 1_000_000)
        elif k == 3: # amount spike vs history
            base[i, 1] = rng.uniform(4, 10) * f + (1 if subtle else 0); base[i, 0] += 0.8 * f
        elif k == 4: # non-PO spend, high frequency
            base[i, 9] = 0; base[i, 8] = rng.integers(5, 12) if not subtle else rng.integers(2, 6)
        else:        # invoice before PO / long-dormant PO
            base[i, 5] = rng.choice([rng.integers(-30, -1), rng.integers(200, 400)])
    return base


def train() -> dict:
    rng = np.random.default_rng(SEED)
    # unsupervised part: only normal history
    X_hist = synth_normal(4000, rng)
    iso = Pipeline([("scale", StandardScaler()),
                    ("iforest", IsolationForest(n_estimators=300, contamination=0.03, random_state=SEED))])
    t0 = time.time()
    iso.fit(X_hist)
    raw = -iso.score_samples(X_hist)
    calib = {"p50": float(np.percentile(raw, 50)), "p99": float(np.percentile(raw, 99.5))}

    # supervised part: audit-labelled history
    X_lab = np.vstack([synth_normal(3000, rng), synth_anomalies(300, rng)])
    y_lab = np.array([0] * 3000 + [1] * 300)
    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, random_state=SEED)
    clf.fit(X_lab, y_lab)
    train_ms = int((time.time() - t0) * 1000)

    model = Ensemble(iso, clf, calib)

    # held-out evaluation (fresh draw, 10% fraud rate, milder fraud than seen in training)
    X_test = np.vstack([synth_normal(900, rng), synth_anomalies(100, rng, subtle=True)])
    y_test = np.array([0] * 900 + [1] * 100)
    s = model.score(X_test)
    pred = (s >= 0.5).astype(int)
    iso_auc = roc_auc_score(y_test, model.iso_score(X_test))
    metrics = {
        "model": "Ensemble: IsolationForest(300 trees) + HistGradientBoosting (0.4 / 0.6)",
        "version": time.strftime("%Y.%m.%d"),
        "features": FEATURES,
        "train_rows": int(len(X_hist) + len(X_lab)),
        "test_rows": int(len(X_test)),
        "threshold": 0.5,
        "precision": round(float(precision_score(y_test, pred)), 3),
        "recall": round(float(recall_score(y_test, pred)), 3),
        "f1": round(float(f1_score(y_test, pred)), 3),
        "roc_auc": round(float(roc_auc_score(y_test, s)), 3),
        "roc_auc_unsupervised_only": round(float(iso_auc), 3),
        "train_ms": train_ms,
        "data": "synthetic AP history (demo) - retrain on SAP RBKP/RSEG + audit labels for production",
    }
    medians = np.median(X_hist, axis=0).tolist()
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump({"model": model, "medians": medians, "metrics": metrics}, MODEL_DIR / "model.joblib")
    (MODEL_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    print(json.dumps(train(), indent=2))
