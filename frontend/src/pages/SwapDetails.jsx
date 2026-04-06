import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_NETWORK } from "../config/network";
import "./SwapDetails.css";

const SWAP_DETAILS_STORAGE_KEY = "movement_last_swap_details_v1";

const formatDate = (iso) => {
  const date = new Date(iso || Date.now());
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const formatTime = (iso) => {
  const date = new Date(iso || Date.now());
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const safeValue = (value, fallback = "-") => {
  const text = String(value || "").trim();
  return text || fallback;
};

export default function SwapDetails() {
  const location = useLocation();
  const navigate = useNavigate();

  const swapDetails = useMemo(() => {
    const fromRoute = location.state?.swapDetails;
    if (fromRoute && typeof fromRoute === "object") return fromRoute;

    try {
      const raw = sessionStorage.getItem(SWAP_DETAILS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, [location.state]);

  if (!swapDetails) {
    return (
      <div className="swap-details-page">
        <div className="swap-details-shell">
          <div className="swap-details-header">
            <button type="button" className="swap-details-back" onClick={() => navigate("/swap")}>←</button>
            <h1>Transaction details</h1>
            <span className="swap-details-spacer" />
          </div>

          <div className="swap-details-empty">
            <p>No recent swap details found.</p>
            <button type="button" onClick={() => navigate("/swap")}>Back to Swap</button>
          </div>
        </div>
      </div>
    );
  }

  const txHash = safeValue(swapDetails.txHash, "");
  const explorerBase = safeValue(swapDetails.explorerBase, DEFAULT_NETWORK.explorer);
  const txLink = txHash ? `${explorerBase}/txn/${txHash}` : null;

  return (
    <div className="swap-details-page">
      <div className="swap-details-shell">
        <div className="swap-details-header">
          <button type="button" className="swap-details-back" onClick={() => navigate("/swap")} aria-label="Back to swap">
            ←
          </button>
          <h1>Transaction details</h1>
          <span className="swap-details-spacer" />
        </div>

        <div className="swap-details-meta">
          <span>{formatDate(swapDetails.completedAt)}</span>
          <span>{formatTime(swapDetails.completedAt)}</span>
        </div>

        <section className="swap-details-card">
          <div className="swap-details-card-title">Swap</div>

          <div className="swap-details-token-row">
            <div className="swap-details-token-line">
              <span className="swap-details-token-amount">{safeValue(swapDetails.fromAmount)}</span>
              <span className="swap-details-token-symbol">{safeValue(swapDetails.fromSymbol)}</span>
            </div>
            <div className="swap-details-arrow">→</div>
            <div className="swap-details-token-line">
              <span className="swap-details-token-amount">{safeValue(swapDetails.toAmount)}</span>
              <span className="swap-details-token-symbol">{safeValue(swapDetails.toSymbol)}</span>
            </div>
          </div>

          <div className="swap-details-provider">{safeValue(swapDetails.provider)} route</div>

          <div className="swap-details-status-list">
            <div className="swap-details-status">✓ Swap completed</div>
            <div className="swap-details-status">✓ Spending approved</div>
          </div>
        </section>

        <section className="swap-details-card compact">
          <div className="swap-details-kv">
            <span>{safeValue(swapDetails.rateLabel)}</span>
          </div>
          <div className="swap-details-kv">
            <span>Network cost</span>
            <strong>{safeValue(swapDetails.networkCostLabel)}</strong>
          </div>
          <div className="swap-details-kv">
            <span>Price impact</span>
            <strong>{safeValue(swapDetails.priceImpact)}%</strong>
          </div>
          <div className="swap-details-kv">
            <span>Slippage</span>
            <strong>{safeValue(swapDetails.slippage)}%</strong>
          </div>
        </section>

        <section className="swap-details-card compact">
          <div className="swap-details-transfer-head">
            <span>Trx hash</span>
            {txLink ? (
              <a href={txLink} target="_blank" rel="noopener noreferrer" className="swap-details-open">
                Open ↗
              </a>
            ) : null}
          </div>
          <code>{txHash || "Unavailable"}</code>
        </section>

        <button type="button" className="swap-details-support" onClick={() => navigate("/more")}>Contact support</button>
      </div>
    </div>
  );
}
