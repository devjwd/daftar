import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_NETWORK } from "../config/network";
import { getStoredLanguagePreference, t } from "../utils/language";
import "./SwapDetails.css";

const SWAP_DETAILS_STORAGE_KEY = "movement_last_swap_details_v1";
const SUPPORT_DISCORD_URL = "https://discord.gg/fER9kNyPvk";

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

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 6l-6 6 6 6" />
    <path d="M9 12h10" />
  </svg>
);

export default function SwapDetails() {
  const location = useLocation();
  const navigate = useNavigate();
  const [language, setLanguage] = React.useState(() => getStoredLanguagePreference());

  React.useEffect(() => {
    const syncLanguage = () => setLanguage(getStoredLanguagePreference());
    const onLanguageChange = (event) => {
      if (event?.detail?.language) {
        setLanguage(event.detail.language);
      } else {
        syncLanguage();
      }
    };

    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', syncLanguage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', syncLanguage);
    };
  }, []);

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
            <button type="button" className="swap-details-back" onClick={() => navigate("/swap")} aria-label={t(language, 'swapBackToSwap')}>
              <BackIcon />
            </button>
            <h1>{t(language, 'swapTxDetails')}</h1>
            <span className="swap-details-spacer" />
          </div>

          <div className="swap-details-empty">
            <p>{t(language, 'swapNoDetails')}</p>
            <button type="button" onClick={() => navigate("/swap")}>{t(language, 'swapBackToSwap')}</button>
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
          <button type="button" className="swap-details-back" onClick={() => navigate("/swap")} aria-label={t(language, 'swapBackToSwap')}>
            <BackIcon />
          </button>
          <h1>{t(language, 'swapTxDetails')}</h1>
          <span className="swap-details-spacer" />
        </div>

        <div className="swap-details-meta">
          <span>{formatDate(swapDetails.completedAt)}</span>
          <span>{formatTime(swapDetails.completedAt)}</span>
        </div>

        <section className="swap-details-card">
          <div className="swap-details-card-title">{t(language, 'swapTitle')}</div>

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

          <div className="swap-details-provider">{t(language, 'swapRouteLabel', { provider: safeValue(swapDetails.provider) })}</div>

          <div className="swap-details-status-list">
            <div className="swap-details-status">✓ {t(language, 'swapCompleted')}</div>
          </div>
        </section>

        <section className="swap-details-card compact">
          <div className="swap-details-kv">
            <span>{safeValue(swapDetails.rateLabel)}</span>
          </div>
          <div className="swap-details-kv">
            <span>{t(language, 'swapNetworkCost')}</span>
            <strong>{safeValue(swapDetails.networkCostLabel)}</strong>
          </div>
          <div className="swap-details-kv">
            <span>{t(language, 'swapPriceImpact')}</span>
            <strong>{safeValue(swapDetails.priceImpact)}%</strong>
          </div>
          <div className="swap-details-kv">
            <span>{t(language, 'swapSlippage')}</span>
            <strong>{safeValue(swapDetails.slippage)}%</strong>
          </div>
        </section>

        <section className="swap-details-card compact">
          <div className="swap-details-transfer-head">
            <span>{t(language, 'swapTrxHash')}</span>
            {txLink ? (
              <a href={txLink} target="_blank" rel="noopener noreferrer" className="swap-details-open">
                {t(language, 'swapOpenExplorer')}
              </a>
            ) : null}
          </div>
          <code>{txHash || t(language, 'swapUnavailable')}</code>
        </section>

        <button
          type="button"
          className="swap-details-support"
          onClick={() => window.open(SUPPORT_DISCORD_URL, "_blank", "noopener,noreferrer")}
        >
          {t(language, 'swapContactSupport')}
        </button>
      </div>
    </div>
  );
}
