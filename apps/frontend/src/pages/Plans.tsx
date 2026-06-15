import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useProfile } from '../hooks/useProfile';
import { getPlanList, getPlansConfig, verifySubscriptionPayment } from '../services/api';
import { normalizeAddress } from '../utils/address';
import { useMovementClient } from '../hooks/useMovementClient';
import { supabase } from '../services/supabase';
import './Plans.css';

interface PlanDefinition {
  id: 'free' | 'pro';
  name: string;
  price: number;
  interval: string | null;
  features: string[];
  limits: {
    pnlHistory: boolean;
    analytics: boolean;
    visualizer: boolean;
    prioritySupport: boolean;
    earlyFeatures: boolean;
  };
}

interface PlansConfig {
  basePriceUsd: number;
  discountPriceUsd: number | null;
  discountLabel: string;
  treasuryWallet: string;
  durationDays: number;
  movePriceUsd: number;
  discountScope?: 'first_month' | 'all_months';
}

// ─── Payment Modal ──────────────────────────────────────────────────────────
interface PaymentModalProps {
  config: PlansConfig;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => void;
  signAndSubmitTransaction: any;
  client: any;
}

function PaymentModal({ config, walletAddress, onClose, onSuccess, signAndSubmitTransaction, client }: PaymentModalProps) {
  const [selectedMonths, setSelectedMonths] = useState<number>(1);
  const [step, setStep] = useState<'confirm' | 'sending' | 'verifying' | 'purchased' | 'processing' | 'success' | 'error'>('confirm');
  const [syncProgress, setSyncProgress] = useState({ synced: 0, total: 0 });
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Calculate pricing based on selectedMonths and discountScope
  const discountScope = config.discountScope || 'all_months';
  const hasDiscount = config.discountPriceUsd !== null;
  
  let totalPriceUsd = 0;
  if (hasDiscount && config.discountPriceUsd !== null) {
    if (discountScope === 'first_month') {
      totalPriceUsd = config.discountPriceUsd + (selectedMonths - 1) * config.basePriceUsd;
    } else {
      totalPriceUsd = config.discountPriceUsd * selectedMonths;
    }
  } else {
    totalPriceUsd = config.basePriceUsd * selectedMonths;
  }

  const moveAmount = config.movePriceUsd > 0 ? totalPriceUsd / config.movePriceUsd : 0;
  // Add 1% buffer so user pays slightly more than minimum (avoids verification rejection at edge)
  const moveAmountWithBuffer = moveAmount * 1.01;
  const octasToSend = Math.ceil(moveAmountWithBuffer * 1e8);
  const moveDisplay = (octasToSend / 1e8).toFixed(4);

  const isInsufficientBalance = balance !== null && balance < (octasToSend / 1e8);

  useEffect(() => {
    if (!client || !walletAddress) return;
    let active = true;
    setBalanceLoading(true);
    client.view({
      payload: {
        function: "0x1::coin::balance",
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: [walletAddress],
      }
    }).then((res: any) => {
      if (!active) return;
      const rawBalance = Number(res?.[0]) || 0;
      setBalance(rawBalance / 1e8);
      setBalanceLoading(false);
    }).catch((err: any) => {
      console.error("Failed to fetch balance:", err);
      if (active) setBalanceLoading(false);
    });

    return () => {
      active = false;
    };
  }, [client, walletAddress]);

  const handleVerify = useCallback(async (hash: string, monthsCount: number) => {
    setStep('verifying');
    try {
      // Wait a few seconds for tx to be indexed
      await new Promise(r => setTimeout(r, 3000));
      const res = await verifySubscriptionPayment(walletAddress, hash, monthsCount);
      if (res.ok) {
        setStep('purchased'); // Show benefits page first, then transition to processing
      } else {
        setErrorMsg(res.error || 'Verification failed. Contact the admin with your tx hash.');
        setStep('error');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Verification request failed.');
      setStep('error');
    }
  }, [walletAddress]);

  // Auto-advance from 'purchased' (benefits page) to 'processing' after 7s
  useEffect(() => {
    if (step !== 'purchased') return;
    const timer = setTimeout(() => setStep('processing'), 7000);
    return () => clearTimeout(timer);
  }, [step]);

  // Poll for sync status when in processing step
  useEffect(() => {
    if (step !== 'processing') return;
    let active = true;
    // 3-minute auto-escape: Pro is activated regardless of sync completion.
    const AUTO_ESCAPE_MS = 3 * 60 * 1000;
    const autoEscapeTimer = setTimeout(() => {
      if (active && step === 'processing') {
        setStep('success');
        setTimeout(() => { if (active) { onSuccess(); onClose(); } }, 2000);
      }
    }, AUTO_ESCAPE_MS);

    const poll = async () => {
      try {
        const { data, error } = await supabase
          .from('user_sync_status')
          .select('full_history_synced, synced_transactions, total_transactions, sync_error')
          .eq('user_address', walletAddress)
          .maybeSingle();

        if (error) console.error('Sync polling error:', error);

        if (data && active) {
          setSyncProgress({
            synced: data.synced_transactions || 0,
            total: data.total_transactions || 0
          });

          if (data.full_history_synced) {
            clearTimeout(autoEscapeTimer);
            setStep('success');
            setTimeout(() => { if (active) { onSuccess(); onClose(); } }, 2000);
            return;
          }

          if (data.sync_error) {
            clearTimeout(autoEscapeTimer);
            setStep('success');
            setTimeout(() => { if (active) { onSuccess(); onClose(); } }, 2000);
            return;
          }
        }
      } catch (err) {
        console.error('Sync polling failed:', err);
      }
      if (active) setTimeout(poll, 2000);
    };

    poll();
    return () => {
      active = false;
      clearTimeout(autoEscapeTimer);
    };
  }, [step, walletAddress, onSuccess, onClose]);

  const handleSendMove = useCallback(async () => {
    if (!config.treasuryWallet) {
      setErrorMsg('Treasury wallet is not configured. Contact the admin.');
      setStep('error');
      return;
    }
    if (isInsufficientBalance) {
      setErrorMsg('You do not have enough MOVE balance to purchase this plan.');
      setStep('error');
      return;
    }
    setStep('sending');
    try {
      const result = await signAndSubmitTransaction({
        sender: walletAddress,
        data: {
          function: '0x1::aptos_account::transfer',
          typeArguments: [],
          functionArguments: [config.treasuryWallet, String(octasToSend)],
        },
      });
      // The wallet adapter returns { hash } or similar
      const hash = result?.hash || result?.transactionHash || result?.txHash || result;
      if (!hash || typeof hash !== 'string') {
        throw new Error('No transaction hash returned from wallet');
      }
      setTxHash(hash);
      // Auto-verify
      await handleVerify(hash, selectedMonths);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Transaction was rejected or failed.');
      setStep('error');
    }
  }, [config.treasuryWallet, octasToSend, walletAddress, signAndSubmitTransaction, handleVerify, selectedMonths, isInsufficientBalance]);

  return (
    <div className="payment-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`payment-modal ${step === 'purchased' || step === 'processing' ? 'payment-modal--wide' : ''}`}>
        <button className="payment-modal-close" onClick={onClose} aria-label="Close">✕</button>

        {step === 'confirm' && (
          <>
            <h2 className="payment-modal-title">Upgrade to Pro</h2>
            <p className="payment-modal-subtitle">
              Pay with MOVE tokens — instant activation, premium Pro access.
            </p>

            {/* Month Selection Buttons */}
            <div style={{ marginBottom: '20px', width: '100%' }}>
              <label style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: '8px', textAlign: 'left', fontWeight: 500 }}>
                Select Duration
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {[1, 2, 3].map((m) => (
                  <button
                    key={m}
                    type="button"
                    style={{
                      padding: '10px 6px',
                      borderRadius: '8px',
                      background: selectedMonths === m ? 'rgba(205, 161, 105, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedMonths === m ? '1px solid #cda169' : '1px solid rgba(255,255,255,0.08)',
                      color: selectedMonths === m ? '#cda169' : 'rgba(255,255,255,0.65)',
                      fontWeight: selectedMonths === m ? 'bold' : 'normal',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      outline: 'none',
                      fontSize: '13px'
                    }}
                    onClick={() => setSelectedMonths(m)}
                  >
                    {m} {m === 1 ? 'Month' : 'Months'}
                  </button>
                ))}
              </div>
            </div>

            <div className="payment-summary-card">
              <div className="payment-summary-row">
                <span>Plan</span>
                <strong>Pro — {config.durationDays * selectedMonths} days</strong>
              </div>
              <div className="payment-summary-row">
                <span>Price</span>
                <strong>
                  {hasDiscount && (
                    <s style={{ color: 'rgba(255,255,255,0.35)', marginRight: '8px' }}>
                      ${(config.basePriceUsd * selectedMonths).toFixed(2)}
                    </s>
                  )}
                  ${totalPriceUsd.toFixed(2)}
                </strong>
              </div>
              <div className="payment-summary-row payment-summary-highlight">
                <span>You Send</span>
                <strong>{moveDisplay} MOVE</strong>
              </div>
              <div className="payment-summary-row" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Your Balance</span>
                <strong>
                  {balanceLoading ? (
                    <span style={{ color: 'rgba(255,255,255,0.35)' }}>Loading...</span>
                  ) : balance !== null ? (
                    <span style={{ color: isInsufficientBalance ? '#ef4444' : '#10b981' }}>
                      {balance.toFixed(4)} MOVE
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>
                  )}
                </strong>
              </div>
              <div className="payment-summary-row" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', borderTop: 'none', paddingTop: 0 }}>
                <span>Rate</span>
                <span>1 MOVE ≈ ${config.movePriceUsd.toFixed(4)}</span>
              </div>
            </div>

            <button
              className="payment-cta-btn"
              onClick={handleSendMove}
              disabled={isInsufficientBalance}
              style={{
                background: isInsufficientBalance ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #e5be8a, #cda169)',
                color: isInsufficientBalance ? 'rgba(255,255,255,0.25)' : '#0d0d0d',
                cursor: isInsufficientBalance ? 'not-allowed' : 'pointer',
                border: isInsufficientBalance ? '1px solid rgba(255,255,255,0.08)' : 'none',
                boxShadow: isInsufficientBalance ? 'none' : undefined,
              }}
            >
              {isInsufficientBalance ? 'Insufficient Balance' : 'Purchase Pro Plan'}
            </button>
            <p className="payment-note">
              Clicking "Purchase Pro Plan" will open your wallet to confirm the transfer. Your subscription activates instantly after confirmation.
            </p>
          </>
        )}

        {step === 'sending' && (
          <div className="payment-status-state">
            <div className="payment-spinner" />
            <h3>Awaiting Wallet Confirmation</h3>
            <p>Please approve the transaction in your wallet...</p>
          </div>
        )}

        {step === 'verifying' && (
          <div className="payment-status-state">
            <div className="payment-spinner" />
            <h3>Verifying On-Chain</h3>
            <p>Confirming your payment on the Movement Network...</p>
            {txHash && (
              <code className="payment-tx-hash">{txHash.slice(0, 14)}...{txHash.slice(-10)}</code>
            )}
          </div>
        )}

        {/* ── PURCHASED: Benefits showcase ── */}
        {step === 'purchased' && (
          <div className="post-purchase-screen" style={{ animation: 'fadeSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}>
            {/* Confetti burst icon */}
            <div className="post-purchase-hero">
              <div className="post-purchase-badge-ring">
                <span className="post-purchase-crown">👑</span>
              </div>
              <div className="post-purchase-title">Welcome to Pro!</div>
              <div className="post-purchase-subtitle">
                Your {config.durationDays * selectedMonths}-day Pro subscription is now active
              </div>
            </div>

            <div className="pro-benefits-grid">
              {[
                { icon: '📊', title: 'Full Analytics', desc: 'Complete portfolio breakdown, protocol usage & exchange tracking' },
                { icon: '📈', title: 'PNL History', desc: 'Historical net worth charts across all timeframes — 1D to All-time' },
                { icon: '🔍', title: 'Transaction Indexing', desc: 'Your full on-chain history is being indexed right now' },
                { icon: '🎨', title: 'Portfolio Visualizer', desc: 'Interactive 3D visualization of your DeFi positions' },
                { icon: '⚡', title: 'Priority Sync', desc: 'Your wallet syncs every 5 minutes instead of hourly' },
                { icon: '🔔', title: 'Alerts & Insights', desc: 'Real-time notifications for large inflows and protocol activity' },
              ].map((b, i) => (
                <div
                  key={b.title}
                  className="pro-benefit-card"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="pro-benefit-icon">{b.icon}</div>
                  <div className="pro-benefit-text">
                    <div className="pro-benefit-title">{b.title}</div>
                    <div className="pro-benefit-desc">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="post-purchase-footer">
              <div className="post-purchase-indexing-hint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cda169" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, animation: 'postPurchaseSpin 2s linear infinite' }}>
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
                </svg>
                <span>Blockchain indexing in progress — charts load automatically</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
                <button
                  className="payment-retry-btn"
                  style={{ background: 'rgba(205,161,105,0.12)', border: '1px solid rgba(205,161,105,0.35)', color: '#cda169', fontWeight: 700, padding: '10px 24px' }}
                  onClick={() => { onSuccess(); onClose(); }}
                >
                  Go to Dashboard →
                </button>
                <button
                  className="payment-retry-btn"
                  style={{ color: 'rgba(255,255,255,0.5)' }}
                  onClick={() => setStep('processing')}
                >
                  View Progress
                </button>
              </div>
              <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', margin: '12px 0 0' }}>Auto-advancing to sync view in a few seconds...</p>
            </div>
          </div>
        )}

        {/* ── PROCESSING: Data sync progress ── */}
        {step === 'processing' && (
          <div className="processing-screen">
            <div className="processing-header">
              <div className="processing-orbit">
                <div className="processing-orbit-ring" />
                <div className="processing-orbit-ring processing-orbit-ring--2" />
                <div className="processing-orbit-core">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cda169" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
              </div>
              <div className="processing-title">Setting Up Your Pro Account</div>
              <div className="processing-subtitle">Indexing your full on-chain history from the Movement Network</div>
            </div>

            {/* Sync progress bar */}
            <div className="processing-progress-section">
              <div className="processing-progress-bar-wrap">
                <div
                  className="processing-progress-bar-fill"
                  style={{
                    width: syncProgress.total > 0
                      ? `${Math.min(100, Math.max(3, (syncProgress.synced / syncProgress.total) * 100))}%`
                      : '15%',
                  }}
                />
              </div>
              <div className="processing-progress-labels">
                <span>
                  {syncProgress.total > 0
                    ? `${syncProgress.synced.toLocaleString()} / ${syncProgress.total.toLocaleString()} transactions`
                    : 'Fetching transaction count...'}
                </span>
                {syncProgress.total > 0 && (
                  <span style={{ color: '#cda169' }}>
                    {Math.round((syncProgress.synced / syncProgress.total) * 100)}%
                  </span>
                )}
              </div>
            </div>

            {/* Steps checklist */}
            <div className="processing-steps">
              {[
                { label: 'Payment verified on-chain', done: true },
                { label: 'Pro subscription activated', done: true },
                { label: 'Blockchain history being indexed', done: false, active: true },
                { label: 'Analytics charts ready', done: false },
              ].map((s) => (
                <div key={s.label} className={`processing-step ${
                  s.done ? 'processing-step--done' : s.active ? 'processing-step--active' : ''
                }`}>
                  <div className="processing-step-icon">
                    {s.done ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : s.active ? (
                      <div className="processing-step-pulse" />
                    ) : (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                    )}
                  </div>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Info boxes */}
            <div className="processing-info-row">
              <div className="processing-info-box">
                <div className="processing-info-label">Status</div>
                <div className="processing-info-value" style={{ color: '#36c690' }}>● Active</div>
              </div>
              <div className="processing-info-box">
                <div className="processing-info-label">Duration</div>
                <div className="processing-info-value">{config.durationDays * selectedMonths}d</div>
              </div>
              <div className="processing-info-box">
                <div className="processing-info-label">Auto-finish</div>
                <div className="processing-info-value">3 min</div>
              </div>
            </div>

            <div className="processing-cta-row">
              <button
                className="payment-cta-btn"
                style={{ margin: 0, padding: '12px 32px', width: 'auto', fontSize: '13px' }}
                onClick={() => { onSuccess(); onClose(); }}
              >
                Open Dashboard Now →
              </button>
              <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', margin: '8px 0 0', textAlign: 'center' }}>
                Indexing continues in the background after you leave
              </p>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="payment-status-state payment-success">
            <div className="payment-success-icon">✓</div>
            <h3>Pro Activated!</h3>
            <p>Your Pro subscription is active for {config.durationDays * selectedMonths} days. Enjoy all premium features!</p>
          </div>
        )}

        {step === 'error' && (
          <div className="payment-status-state payment-error">
            <div className="payment-error-icon">✕</div>
            <h3>Payment Issue</h3>
            <p>{errorMsg}</p>
            {txHash && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Your tx hash (for manual verification):</p>
                <code className="payment-tx-hash">{txHash}</code>
              </div>
            )}
            <button className="payment-retry-btn" onClick={() => setStep('confirm')}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plans Page ─────────────────────────────────────────────────────────────
export default function Plans() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const { client: movementClient } = useMovementClient();
  const walletAddress = connected && account?.address ? normalizeAddress(String(account.address)) : null;
  const { profile, loading: profileLoading, refresh: refreshProfile } = useProfile(walletAddress);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [plansConfig, setPlansConfig] = useState<PlansConfig | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Derive current tier
  const rawTier = profile?.subscription_tier || (profile?.is_verified ? 'pro' : 'free');
  const currentTier = rawTier === 'lite' ? 'pro' : rawTier;

  useEffect(() => {
    async function loadData() {
      try {
        const [fetchedPlans, fetchedConfig] = await Promise.all([
          getPlanList(),
          getPlansConfig(),
        ]);
        if (fetchedPlans && fetchedPlans.length > 0) {
          setPlans(fetchedPlans.filter((p: any) => p.id !== 'lite'));
        }
        if (fetchedConfig) {
          setPlansConfig(fetchedConfig);
        }
      } catch (err) {
        console.error('Failed to load plans:', err);
      } finally {
        setLoadingPlans(false);
      }
    }
    loadData();
  }, []);

  const handlePaymentSuccess = useCallback(() => {
    // Refresh profile to reflect new tier without hard reloading
    refreshProfile();
  }, [refreshProfile]);

  const effectivePriceUsd = plansConfig
    ? (plansConfig.discountPriceUsd !== null ? plansConfig.discountPriceUsd : plansConfig.basePriceUsd)
    : 5;

  const moveEquivalent = plansConfig && plansConfig.movePriceUsd > 0
    ? (effectivePriceUsd / plansConfig.movePriceUsd).toFixed(2)
    : null;

  // Fallback plans if API fails
  const displayPlans: PlanDefinition[] = plans.length > 0 ? plans : [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      interval: null,
      features: ['Portfolio Tracker', 'Transaction History', 'NFT Gallery', '24h PNL Overview'],
      limits: { pnlHistory: false, analytics: false, visualizer: false, prioritySupport: false, earlyFeatures: false },
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 5,
      interval: 'month',
      features: ['Everything in Free', 'Full PNL History (All Timeframes)', 'Portfolio Analytics Dashboard', 'Transaction Visualizer', 'Advanced Transaction Filters', 'Priority Support', 'Early Access to New Features', 'Pro Badge on Profile'],
      limits: { pnlHistory: true, analytics: true, visualizer: true, prioritySupport: true, earlyFeatures: true },
    },
  ];

  const getPlanDescription = (id: 'free' | 'pro') => {
    if (id === 'free') return 'Standard features for on-chain exploration and wallet tracking.';
    return 'Maximum capabilities, priority support, and early updates.';
  };

  return (
    <div className="plans-page">
      <div className="plans-bg">
        <div className="plans-orb plans-orb-1" />
        <div className="plans-orb plans-orb-2" />
      </div>

      <header className="plans-header">
        <h1 className="plans-title">Flexible Plan Tiers</h1>
        <p className="plans-subtitle">
          Scale your on-chain portfolio intelligence with tools built for the Movement Network.
        </p>
      </header>

      <div className="plans-grid">
        {displayPlans.map((plan) => {
          const isCurrent = plan.id === currentTier;
          const isFeatured = plan.id === 'pro';
          const hasDiscount = plansConfig?.discountPriceUsd !== null && plansConfig?.discountPriceUsd !== undefined;

          return (
            <div
              key={plan.id}
              className={`plans-card ${isFeatured ? 'featured' : ''}`}
            >
              {isFeatured && <div className="recommended-badge">Recommended</div>}

              <div className="plans-card-header">
                <h3 className={`plan-tier-label ${plan.id === 'pro' ? 'pro-label' : ''}`}>
                  {plan.name}
                  {isCurrent && <span className="current-plan-badge">Current Plan</span>}
                </h3>

                <p className="plans-plan-desc">{getPlanDescription(plan.id)}</p>

                <div className="plans-price-row">
                  {plan.price === 0 ? (
                    <span className="plans-price-free">Free</span>
                  ) : (
                    <div className="plans-price-block">
                      <div className="plans-price-main">
                        {hasDiscount && plansConfig && (
                          <s className="plans-price-original">${plansConfig.basePriceUsd}</s>
                        )}
                        <span className="plans-price">
                          ${plansConfig ? effectivePriceUsd : plan.price}
                        </span>
                        <span className="plans-price-period">/{plansConfig ? `${plansConfig.durationDays}d` : 'mo'}</span>
                      </div>

                      {hasDiscount && plansConfig?.discountLabel && (
                        <div className="plans-discount-badge">
                          🏷️ {plansConfig.discountLabel}
                        </div>
                      )}

                      {moveEquivalent && (
                        <div className="plans-move-price">
                          ≈ <strong>{moveEquivalent} MOVE</strong>
                          <span className="plans-move-rate">
                            {' '}@ ${plansConfig?.movePriceUsd.toFixed(4)}/MOVE
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="plans-divider" />

              <ul className="plans-features">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="plans-feature-item">
                    <span className="feature-check included">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    {feature}
                  </li>
                ))}

                {plan.id === 'free' && (
                  <>
                    {['Full PNL History', 'Portfolio Analytics', 'Transaction Visualizer', 'Priority Support'].map(f => (
                      <li key={f} className="plans-feature-item excluded-feature">
                        <span className="feature-check excluded">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </span>
                        {f}
                      </li>
                    ))}
                  </>
                )}
              </ul>

              {/* CTA */}
              {plan.id === 'free' ? (
                <button
                  className={`plans-cta ${isCurrent ? 'cta-current' : 'cta-free'}`}
                  disabled={isCurrent}
                >
                  {isCurrent ? 'Active Plan' : 'Downgrade'}
                </button>
              ) : isCurrent ? (
                <button className="plans-cta cta-current" disabled>
                  ✓ Active Plan
                </button>
              ) : !connected ? (
                <button
                  className="plans-cta cta-pro"
                  onClick={() => alert('Connect your wallet to upgrade.')}
                >
                  Connect Wallet to Pay
                </button>
              ) : (
                <button
                  className="plans-cta cta-pro plans-cta-pay"
                  onClick={() => setShowPaymentModal(true)}
                  disabled={loadingPlans || profileLoading}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  Get Pro Plan
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && plansConfig && walletAddress && (
        <PaymentModal
          config={plansConfig}
          walletAddress={walletAddress}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
          signAndSubmitTransaction={signAndSubmitTransaction}
          client={movementClient}
        />
      )}
    </div>
  );
}
