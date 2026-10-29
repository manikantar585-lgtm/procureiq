"""Model wrapper (own module so joblib can unpickle it from both train.py and app.py)."""
import numpy as np


class Ensemble:
    """Callable wrapper so app.py can score with one object."""

    def __init__(self, iso, clf, calib):
        self.iso, self.clf, self.calib = iso, clf, calib

    def iso_score(self, X):
        raw = -self.iso.score_samples(X)
        return np.clip((raw - self.calib["p50"]) / (self.calib["p99"] - self.calib["p50"]), 0, 1)

    def score(self, X):
        return 0.4 * self.iso_score(X) + 0.6 * self.clf.predict_proba(X)[:, 1]
