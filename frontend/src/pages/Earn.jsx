import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import TransactionToast from '../components/TransactionToast.jsx';
import useCanopy from '../hooks/useCanopy.js';
import { useIndexerBalances } from '../hooks/useIndexerBalances.js';
import { DEFAULT_NETWORK } from '../config/network.js';
import { getTokenAddressBySymbol, getTokenInfo, getSwapAssetTypeBySymbol } from '../config/tokens.js';
import { getTokenDecimals } from '../utils/tokenUtils.js';
import styles from './Earn.module.css';

const AMOUNT_INPUT_PATTERN = /^\d*(\.\d*)?$/;
const DEFAULT_DECIMALS = 8;
const TOAST_DISMISS_MS = 5000;
const CANOPY_EARN_URL = 'https://app.canopyhub.xyz/earn';
const CANOPY_ATTRIBUTION_URL = 'https://canopyhub.xyz';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount >= 1000 ? 0 : 2,
    maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
};

const formatNumber = (value, options = {}) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
    ...options,
  }).format(amount);
};

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const trimTrailingZeros = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const toBaseUnitsString = (amountStr, decimals = DEFAULT_DECIMALS) => {
  const normalized = String(amountStr || '').trim();
  if (!normalized || !AMOUNT_INPUT_PATTERN.test(normalized)) return null;

  const safeDecimals = Math.max(0, Math.min(18, Number(decimals) || 0));
  const [wholeRaw, fractionalRaw = ''] = normalized.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fractional = fractionalRaw.slice(0, safeDecimals).padEnd(safeDecimals, '0');
  const merged = `${whole}${fractional}`.replace(/^0+(?=\d)/, '');
  return merged.length > 0 ? merged : '0';
};

const normalizeWalletAddress = (account) => {
  if (!account?.address) return '';
  const value = typeof account.address === 'string' ? account.address : account.address.toString();
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
};

const resolveVaultCoinType = (vault) => {
  const asset = String(vault?.asset || '').trim();
  if (!asset) return '';
  if (asset.includes('::')) return asset;
  return getSwapAssetTypeBySymbol(asset) || '';
};

const resolveVaultDecimals = (vault) => {
  const coinType = resolveVaultCoinType(vault);
  if (coinType) {
    return getTokenDecimals(`0x1::coin::CoinStore<${coinType}>`);
  }

  const address = getTokenAddressBySymbol(vault?.asset);
  return getTokenInfo(address)?.decimals || DEFAULT_DECIMALS;
};

const resolveVaultBalance = (vault, balances) => {
  const assetSymbol = String(vault?.asset || '').trim().toUpperCase();
  const assetAddress = getTokenAddressBySymbol(assetSymbol);
  const coinType = resolveVaultCoinType(vault).toLowerCase();

  return balances.find((balance) => {
    const balanceSymbol = String(balance?.symbol || '').trim().toUpperCase();
    const balanceAddress = String(balance?.address || '').trim().toLowerCase();
    const balanceType = String(balance?.fullType || '').trim().toLowerCase();

    if (assetSymbol && balanceSymbol === assetSymbol) return true;
    if (assetAddress && balanceAddress === assetAddress.toLowerCase()) return true;
    if (coinType && balanceType.includes(coinType)) return true;
    return false;
  }) || null;
};

const SkeletonCard = ({ tall = false }) => (
  <div className={`${styles.skeletonCard} ${tall ? styles.skeletonCardTall : ''}`}>
    <div className={styles.skeletonShimmer} />
  </div>
);

const FALLBACK_VAULTS = [
  {
    id: 'fallback-move',
    name: 'MOVE Vault',
    strategy: 'Canopy vault',
    asset: 'MOVE',
    apy: 0,
    tvl: 0,
    externalUrl: CANOPY_EARN_URL,
    fallbackNote: 'Visit Canopy directly to deposit',
  },
  {
    id: 'fallback-usdc',
    name: 'USDC Vault',
    strategy: 'Canopy vault',
    asset: 'USDC',
    apy: 0,
    tvl: 0,
    externalUrl: CANOPY_EARN_URL,
    fallbackNote: 'Visit Canopy directly to deposit',
  },
];

const getCanopyVaultUrl = (vault) => {
  if (vault?.externalUrl) {
    return vault.externalUrl;
  }

  const vaultId = vault?.id != null ? String(vault.id) : '';
  const asset = String(vault?.asset || '').trim();
  const params = new URLSearchParams();
  if (vaultId) params.set('vault', vaultId);
  if (asset) params.set('asset', asset);

  const query = params.toString();
  return query ? `${CANOPY_EARN_URL}?${query}` : CANOPY_EARN_URL;
};

const WalletPicker = ({ wallets, onSelectWallet }) => {
  const visibleWallets = wallets.filter(
    (wallet) => !wallet.name.includes('Google') && !wallet.name.includes('Apple')
  );

  if (visibleWallets.length === 0) {
    return <p className={styles.walletPickerEmpty}>No supported wallets detected.</p>;
  }

  return (
    <div className={styles.walletPickerList}>
      {visibleWallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          className={styles.walletOption}
          onClick={() => onSelectWallet(wallet.name)}
        >
          <span>{wallet.name}</span>
          <span className={styles.walletArrow}>↗</span>
        </button>
      ))}
    </div>
  );
};

const ModalShell = ({ title, subtitle, children, onClose }) => (
  <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
    <div
      className={styles.modalCard}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.modalHeader}>
        <div>
          <p className={styles.modalEyebrow}>{subtitle}</p>
          <h3>{title}</h3>
        </div>
        <button type="button" className={styles.modalClose} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  </div>
);

const StatTooltip = ({ label, text }) => (
  <span className={styles.tooltipWrap} tabIndex={0} aria-label={`${label}: ${text}`}>
    <span>{label}</span>
    <span className={styles.tooltipIcon} aria-hidden="true">?</span>
    <span className={styles.tooltipBubble} role="tooltip">{text}</span>
  </span>
);

export default function Earn() {
  const { account, connected, connect, wallets } = useWallet();
  const {
    vaults,
    userPositions,
    pendingRewards,
    totalDeposited,
    isLoading,
    isDepositing,
    isWithdrawing,
    isClaiming,
    error,
    hasFetchFailed,
    deposit,
    withdraw,
    claimRewards,
    refreshData,
  } = useCanopy();

  const walletAddress = normalizeWalletAddress(account);
  const { balances } = useIndexerBalances(walletAddress);

  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [activeDepositVault, setActiveDepositVault] = useState(null);
  const [activeWithdrawVault, setActiveWithdrawVault] = useState(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [txToast, setTxToast] = useState(null);

  const totalVaultTvl = useMemo(
    () => vaults.reduce((sum, vault) => sum + Number(vault?.tvl || 0), 0),
    [vaults]
  );

  const positionByVaultId = useMemo(
    () => new Map(userPositions.map((position) => [Number(position.vaultId), position])),
    [userPositions]
  );

  const activeDepositBalance = useMemo(
    () => resolveVaultBalance(activeDepositVault, balances),
    [activeDepositVault, balances]
  );

  const activeWithdrawPosition = useMemo(
    () => (activeWithdrawVault ? positionByVaultId.get(Number(activeWithdrawVault.id)) || null : null),
    [activeWithdrawVault, positionByVaultId]
  );

  const stats = useMemo(
    () => [
      {
        label: 'Total TVL',
        value: formatCurrency(totalVaultTvl),
        note: 'Across Canopy vault strategies',
      },
      {
        label: 'Active Vaults',
        value: formatNumber(vaults.length),
        note: 'Live and accepting deposits',
      },
      {
        label: 'Your Deposits',
        value: connected ? formatCurrency(totalDeposited) : 'Connect wallet',
        note: connected ? 'Tracked across all Canopy positions' : 'Sign in to view personal vault exposure',
      },
    ],
    [connected, totalDeposited, totalVaultTvl, vaults.length]
  );

  const rewardBreakdown = pendingRewards?.breakdown || [];
  const contractsUnavailable = hasFetchFailed && vaults.length === 0;
  const usesFallbackVaults = !isLoading && vaults.length === 0;
  const displayedVaults = usesFallbackVaults ? FALLBACK_VAULTS : vaults;
  const hasNoPositions = connected && !isLoading && !usesFallbackVaults && userPositions.length === 0;

  const showToast = useCallback((toast) => {
    setTxToast(toast);
  }, []);

  const closeModals = useCallback(() => {
    setActiveDepositVault(null);
    setActiveWithdrawVault(null);
    setDepositAmount('');
    setWithdrawAmount('');
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeModals();
        setWalletPickerOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeModals]);

  useEffect(() => {
    if (!txToast) return undefined;

    const timeoutId = window.setTimeout(() => {
      setTxToast(null);
    }, TOAST_DISMISS_MS);

    return () => window.clearTimeout(timeoutId);
  }, [txToast]);

  const handleConnectWallet = useCallback(async (walletName) => {
    try {
      await connect(walletName);
      setWalletPickerOpen(false);
    } catch (connectError) {
      showToast({
        type: 'error',
        title: 'Wallet connection failed',
        message: String(connectError?.message || 'Please try again.'),
      });
    }
  }, [connect, showToast]);

  const handleDepositOpen = useCallback((vault) => {
    setActiveWithdrawVault(null);
    setWithdrawAmount('');
    setActiveDepositVault(vault);
    setDepositAmount('');
  }, []);

  const handleWithdrawOpen = useCallback((vault) => {
    setActiveDepositVault(null);
    setDepositAmount('');
    setActiveWithdrawVault(vault);
    setWithdrawAmount('');
  }, []);

  const handleDepositSubmit = useCallback(async () => {
    try {
      if (!activeDepositVault) return;

      const amountValue = Number(depositAmount);
      const availableBalance = Number(activeDepositBalance?.numericAmount || 0);
      const decimals = resolveVaultDecimals(activeDepositVault);
      const rawAmount = toBaseUnitsString(depositAmount, decimals);
      const coinType = resolveVaultCoinType(activeDepositVault);

      if (!coinType) {
        showToast({ type: 'error', title: 'Deposit failed', message: 'Vault asset type is not configured for deposits yet.' });
        return;
      }

      if (!rawAmount || !Number.isFinite(amountValue) || amountValue <= 0) {
        showToast({ type: 'error', title: 'Deposit failed', message: 'Enter a valid deposit amount.' });
        return;
      }

      if (availableBalance > 0 && amountValue > availableBalance) {
        showToast({ type: 'error', title: 'Deposit failed', message: 'Deposit amount exceeds your available balance.' });
        return;
      }

      const txHash = await deposit(activeDepositVault.id, rawAmount, coinType);
      if (!txHash) {
        showToast({ type: 'error', title: 'Deposit failed', message: 'Deposit transaction was not submitted.' });
        return;
      }

      showToast({
        type: 'success',
        title: 'Deposit successful!',
        message: 'Your assets are now earning yield.',
        txHash,
      });
      closeModals();
    } catch (submitError) {
      showToast({ type: 'error', title: 'Deposit failed', message: String(submitError?.message || 'Unexpected deposit error.') });
    }
  }, [activeDepositBalance, activeDepositVault, closeModals, deposit, depositAmount, showToast]);

  const handleWithdrawSubmit = useCallback(async () => {
    try {
      if (!activeWithdrawVault || !activeWithdrawPosition) return;

      const amountValue = Number(withdrawAmount);
      const maxAmount = Number(activeWithdrawPosition.currentValue || activeWithdrawPosition.deposited || 0);
      const decimals = resolveVaultDecimals(activeWithdrawVault);
      const rawAmount = toBaseUnitsString(withdrawAmount, decimals);

      if (!rawAmount || !Number.isFinite(amountValue) || amountValue <= 0) {
        showToast({ type: 'error', title: 'Withdrawal failed', message: 'Enter a valid withdrawal amount.' });
        return;
      }

      if (maxAmount > 0 && amountValue > maxAmount) {
        showToast({ type: 'error', title: 'Withdrawal failed', message: 'Withdrawal amount exceeds your current position.' });
        return;
      }

      const txHash = await withdraw(activeWithdrawVault.id, rawAmount);
      if (!txHash) {
        showToast({ type: 'error', title: 'Withdrawal failed', message: 'Withdrawal transaction was not submitted.' });
        return;
      }

      showToast({
        type: 'success',
        title: 'Withdrawal successful!',
        message: 'Your vault position has been updated.',
        txHash,
      });
      closeModals();
    } catch (submitError) {
      showToast({ type: 'error', title: 'Withdrawal failed', message: String(submitError?.message || 'Unexpected withdrawal error.') });
    }
  }, [activeWithdrawPosition, activeWithdrawVault, closeModals, showToast, withdraw, withdrawAmount]);

  const handleClaimAll = useCallback(async () => {
    try {
      const txHash = await claimRewards();
      if (!txHash) {
        showToast({ type: 'error', title: 'Claim failed', message: 'Reward claim transaction was not submitted.' });
        return;
      }

      showToast({
        type: 'success',
        title: 'Rewards claimed successfully!',
        message: 'Claimed rewards are on the way to your wallet.',
        txHash,
      });
    } catch (claimError) {
      showToast({ type: 'error', title: 'Claim failed', message: String(claimError?.message || 'Unexpected claim error.') });
    }
  }, [claimRewards, showToast]);

  const loadingView = isLoading && vaults.length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.backdrop} />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrow}>Yield hub</span>
            <div className={styles.attribution}>
              <img src="/canopy.png" alt="Canopy Finance" className={styles.attributionLogo} />
              <span>Powered by Canopy Finance</span>
            </div>
          </div>
          <h1>Earn</h1>
          <p className={styles.subtitle}>
            Deploy idle assets into Canopy vaults, compound yield, and claim rewards without leaving Daftar.
          </p>
        </div>

        <div className={styles.heroPanel}>
          <div className={styles.heroMetric}>
            <span className={styles.metricLabel}>Total deposited</span>
            <strong>{connected ? formatCurrency(totalDeposited) : 'Connect wallet'}</strong>
            <span className={styles.metricHint}>
              {connected ? 'Your active Canopy positions' : 'Wallet required for personal vault data'}
            </span>
          </div>

          <div className={styles.heroMetric}>
            <div className={styles.metricHeaderInline}>
              <span className={styles.metricLabel}>Pending rewards</span>
              <button
                type="button"
                className={styles.claimButton}
                onClick={handleClaimAll}
                disabled={!connected || isClaiming || !pendingRewards || Number(pendingRewards.totalRewards || 0) <= 0}
              >
                {isClaiming ? 'Claiming...' : 'Claim All'}
              </button>
            </div>
            <strong>
              {connected && pendingRewards
                ? formatNumber(pendingRewards.totalRewards, { maximumFractionDigits: 4 })
                : '0.00'}
            </strong>
            <div className={styles.rewardTokens}>
              {rewardBreakdown.length > 0 ? rewardBreakdown.map((entry) => (
                <span key={`${entry.token}-${entry.amount}`} className={styles.rewardPill}>
                  {formatNumber(entry.amount, { maximumFractionDigits: 4 })} {entry.token}
                </span>
              )) : <span className={styles.metricHint}>No claimable rewards yet</span>}
            </div>
          </div>
        </div>
      </section>

      {contractsUnavailable ? (
        <div className={styles.errorBanner}>
          <div>
            <strong>Canopy vaults temporarily unavailable.</strong>
            <span>Try again later.</span>
          </div>
          <button type="button" className={styles.retryButton} onClick={refreshData}>
            Retry
          </button>
        </div>
      ) : error ? (
        <div className={styles.errorBanner}>
          <div>
            <strong>{error}</strong>
          </div>
          <button type="button" className={styles.retryButton} onClick={refreshData}>
            Retry
          </button>
        </div>
      ) : null}

      <section className={styles.statsRow}>
        {loadingView ? [0, 1, 2].map((item) => <SkeletonCard key={item} />) : stats.map((stat) => (
          <article key={stat.label} className={styles.statCard}>
            <span className={styles.statLabel}>{stat.label}</span>
            <strong className={styles.statValue}>{stat.value}</strong>
            <p className={styles.statNote}>{stat.note}</p>
          </article>
        ))}
      </section>

      {!connected ? (
        <section className={styles.emptyState}>
          <div>
            <p className={styles.emptyEyebrow}>Wallet required</p>
            <h2>Connect your wallet to start earning</h2>
            <p>
              Link Petra or OKX to view your Canopy positions, deposit into vaults, and claim rewards from within Daftar.
            </p>
          </div>

          <div className={styles.emptyActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setWalletPickerOpen((open) => !open)}
            >
              Connect wallet
            </button>
            {walletPickerOpen ? <WalletPicker wallets={wallets} onSelectWallet={handleConnectWallet} /> : null}
          </div>
        </section>
      ) : null}

      {hasNoPositions ? (
        <section className={styles.noPositionsCallout}>
          <div>
            <p className={styles.emptyEyebrow}>No active deposits</p>
            <h2>You haven't deposited yet.</h2>
            <p>Start earning yield with your assets.</p>
          </div>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => displayedVaults[0] && handleDepositOpen(displayedVaults[0])}
            disabled={!displayedVaults[0] || contractsUnavailable}
          >
            Explore first vault
          </button>
        </section>
      ) : null}

      <section className={styles.vaultSection}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Vault list</p>
            <h2>Canopy strategies</h2>
          </div>
          <span className={styles.sectionMeta}>{displayedVaults.length} active vaults</span>
        </div>

        <div className={styles.vaultGrid}>
          {loadingView ? [0, 1, 2, 3].map((item) => <SkeletonCard key={item} tall />) : displayedVaults.map((vault, index) => {
            const position = positionByVaultId.get(Number(vault.id));
            const vaultUrl = getCanopyVaultUrl(vault);
            const isFallbackCard = Boolean(vault.fallbackNote);
            const depositDisabled = contractsUnavailable || isFallbackCard || !connected || isDepositing || isWithdrawing || isClaiming;
            const withdrawDisabled = contractsUnavailable || isFallbackCard || !position || isDepositing || isWithdrawing || isClaiming;
            const isFeatured = hasNoPositions && index === 0;

            return (
              <article key={vault.id} className={`${styles.vaultCard} ${isFeatured ? styles.featuredVault : ''}`}>
                <div className={styles.vaultHeader}>
                  <div>
                    <p className={styles.vaultStrategy}>{vault.strategy || 'Core vault'}</p>
                    <h3>{vault.name}</h3>
                  </div>
                  <span className={styles.assetBadge}>{vault.asset}</span>
                </div>

                <div className={styles.vaultMetrics}>
                  <div>
                    <span className={styles.metricSmallLabel}>
                      <StatTooltip
                        label="APY"
                        text="Annual Percentage Yield — estimated returns based on current vault performance"
                      />
                    </span>
                    <strong className={styles.apyValue}>{formatPercent(vault.apy)}</strong>
                  </div>
                  <div>
                    <span className={styles.metricSmallLabel}>
                      <StatTooltip
                        label="TVL"
                        text="Total Value Locked — total assets deposited in this vault"
                      />
                    </span>
                    <strong>{formatCurrency(vault.tvl)}</strong>
                  </div>
                </div>

                {position ? (
                  <div className={styles.positionPanel}>
                    <div>
                      <span className={styles.metricSmallLabel}>Your deposit</span>
                      <strong>{formatNumber(position.currentValue || position.deposited, { maximumFractionDigits: 4 })}</strong>
                    </div>
                    <div>
                      <span className={styles.metricSmallLabel}>Pending rewards</span>
                      <strong>{formatNumber(position.pendingRewards, { maximumFractionDigits: 4 })}</strong>
                    </div>
                  </div>
                ) : (
                  <div className={styles.positionEmpty}>
                    <span className={styles.metricSmallLabel}>Your position</span>
                    <p>
                      {vault.fallbackNote
                        ? vault.fallbackNote
                        : contractsUnavailable
                          ? 'Vault data will appear again once Canopy is reachable.'
                          : 'No active deposit in this vault yet.'}
                    </p>
                  </div>
                )}

                <a
                  href={vaultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.externalLink}
                >
                  View on Canopy
                </a>

                <div className={styles.vaultActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => handleDepositOpen(vault)}
                    disabled={depositDisabled}
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => handleWithdrawOpen(vault)}
                    disabled={withdrawDisabled}
                  >
                    Withdraw
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {activeDepositVault ? (
        <ModalShell
          title={activeDepositVault.name}
          subtitle="Deposit into vault"
          onClose={closeModals}
        >
          <div className={styles.modalBody}>
            <div className={styles.modalStatRow}>
              <div>
                <span className={styles.metricSmallLabel}>Supported asset</span>
                <strong>{activeDepositVault.asset}</strong>
              </div>
              <div>
                <span className={styles.metricSmallLabel}>Expected APY</span>
                <strong className={styles.apyValue}>{formatPercent(activeDepositVault.apy)}</strong>
              </div>
            </div>

            <label className={styles.fieldLabel} htmlFor="earn-deposit-amount">Amount</label>
            <div className={styles.inputShell}>
              <input
                id="earn-deposit-amount"
                value={depositAmount}
                onChange={(event) => {
                  if (AMOUNT_INPUT_PATTERN.test(event.target.value)) {
                    setDepositAmount(event.target.value);
                  }
                }}
                inputMode="decimal"
                placeholder="0.00"
                className={styles.amountInput}
              />
              <button
                type="button"
                className={styles.maxButton}
                onClick={() => setDepositAmount(trimTrailingZeros(activeDepositBalance?.numericAmount || '0'))}
              >
                MAX
              </button>
            </div>

            <div className={styles.modalFootnoteRow}>
              <span>Wallet balance</span>
              <strong>
                {formatNumber(activeDepositBalance?.numericAmount || 0, { maximumFractionDigits: 4 })} {activeDepositVault.asset}
              </strong>
            </div>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleDepositSubmit}
              disabled={isDepositing || contractsUnavailable}
            >
              {isDepositing ? 'Confirming deposit...' : 'Confirm Deposit'}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {activeWithdrawVault && activeWithdrawPosition ? (
        <ModalShell
          title={activeWithdrawVault.name}
          subtitle="Withdraw from vault"
          onClose={closeModals}
        >
          <div className={styles.modalBody}>
            <div className={styles.modalStatRow}>
              <div>
                <span className={styles.metricSmallLabel}>Current position</span>
                <strong>
                  {formatNumber(activeWithdrawPosition.currentValue || activeWithdrawPosition.deposited, { maximumFractionDigits: 4 })} {activeWithdrawVault.asset}
                </strong>
              </div>
              <div>
                <span className={styles.metricSmallLabel}>Pending rewards</span>
                <strong>{formatNumber(activeWithdrawPosition.pendingRewards, { maximumFractionDigits: 4 })}</strong>
              </div>
            </div>

            <label className={styles.fieldLabel} htmlFor="earn-withdraw-amount">Amount</label>
            <div className={styles.inputShell}>
              <input
                id="earn-withdraw-amount"
                value={withdrawAmount}
                onChange={(event) => {
                  if (AMOUNT_INPUT_PATTERN.test(event.target.value)) {
                    setWithdrawAmount(event.target.value);
                  }
                }}
                inputMode="decimal"
                placeholder="0.00"
                className={styles.amountInput}
              />
              <button
                type="button"
                className={styles.maxButton}
                onClick={() => setWithdrawAmount(trimTrailingZeros(activeWithdrawPosition.currentValue || activeWithdrawPosition.deposited || '0'))}
              >
                MAX
              </button>
            </div>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleWithdrawSubmit}
              disabled={isWithdrawing || contractsUnavailable}
            >
              {isWithdrawing ? 'Confirming withdrawal...' : 'Confirm Withdraw'}
            </button>
          </div>
        </ModalShell>
      ) : null}

      <footer className={styles.footer}>
        <a
          href={CANOPY_ATTRIBUTION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
        >
          Yield powered by Canopy Finance · canopyhub.xyz
        </a>
      </footer>

      <TransactionToast
        toast={txToast}
        explorerBase={DEFAULT_NETWORK.explorer}
        onClose={() => setTxToast(null)}
      />
    </div>
  );
}