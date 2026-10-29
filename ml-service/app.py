"""
ProcureIQ ML service - invoice anomaly scoring with explanations.

    uvicorn app:app --port 8000
"""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

from features import FEATURES, FEATURE_LABELS, to_vector
import train as trainer
from ensemble import Ensemble  # noqa: F401  (needed for joblib unpickling)

MODEL_PATH = Path(__file__).parent / "model" / "model.joblib"
app = FastAPI(title="ProcureIQ ML Service", version="1.0.0",
              description="Hybrid IsolationForest + Gradient Boosting anomaly detection for supplier invoices (SAP P2P).")
_state: dict = {}


def load():
    if not MODEL_PATH.exists():
        trainer.train()
    _state.update(joblib.load(MODEL_PATH))


load()


class InvoiceFeatures(BaseModel):
    log_amount: float = 0
    amount_zscore: float = 0
    line_count: float = 1
    max_price_var_pct: float = 0
    qty_over_gr_ratio: float = 0
    days_po_to_invoice: float = 7
    vendor_age_days: float = 1000
    threshold_ratio: float = 0
    vendor_invoices_30d: float = 0
    has_po: float = 1


class Factor(BaseModel):
    feature: str
    label: str
    value: float
    contribution: float = Field(description="share of the anomaly score explained by this feature (0-1)")


class Score(BaseModel):
    anomalyScore: float = Field(description="0 = typical, 1 = highly anomalous")
    isAnomaly: bool
    model: str
    topFactors: list[Factor]


def score_vector(x: list[float]) -> Score:
    model = _state["model"]
    X = np.array([x])
    base = model.score(X)
    s = float(base[0])
    # Perturbation attribution: how much does the score drop if a feature is set to its typical value?
    perturbed = np.repeat(X, len(FEATURES), axis=0)
    for i, m in enumerate(_state["medians"]):
        perturbed[i, i] = m
    drops = np.maximum(0, base[0] - model.score(perturbed))
    total = drops.sum() or 1
    order = np.argsort(-drops)[:3]
    factors = [Factor(feature=FEATURES[i], label=FEATURE_LABELS[FEATURES[i]], value=round(x[i], 3),
                      contribution=round(float(drops[i] / total), 3)) for i in order if drops[i] > 0]
    return Score(anomalyScore=round(s, 4), isAnomaly=s >= _state["metrics"]["threshold"],
                 model=f"p2p-ensemble@{_state['metrics']['version']}", topFactors=factors)


@app.get("/health")
def health():
    return {"status": "UP", "model": _state["metrics"]["model"], "version": _state["metrics"]["version"]}


@app.get("/model")
def model_card():
    return _state["metrics"]


@app.post("/score", response_model=Score)
def score(features: InvoiceFeatures):
    return score_vector(to_vector(features.model_dump()))


@app.post("/score/batch", response_model=list[Score])
def score_batch(items: list[InvoiceFeatures]):
    return [score_vector(to_vector(f.model_dump())) for f in items]


@app.post("/retrain")
def retrain():
    metrics = trainer.train()
    load()
    return metrics
