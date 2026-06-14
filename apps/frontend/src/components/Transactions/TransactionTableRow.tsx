import React from 'react';
import styles from './TrxHistory.module.css';
import { DEFAULT_TOKEN_COLOR, TOKEN_VISUALS, DEFI_PROTOCOL_VISUALS } from '../../config/display';
import {
  normalizeDisplayToken,
  getDisplayAmounts,
  getAmountTone,
  formatAmount,
  formatDateTime,
  truncateHash,
} from '../../utils/formatters';

const TYPE_LABELS: Record<string, string> = {
  swap: 'SWAP',
  lend: 'LEND',
  borrow: 'BORROW',
  repay: 'REPAY',
  stake: 'STAKE',
  unstake: 'UNSTAKE',
  deposit: 'DEPOSIT',
  withdraw: 'WITHDRAW',
  transfer: 'TRANSFER',
  send: 'SEND',
  received: 'RECEIVED',
  claim: 'CLAIM',
  airdrop: 'AIRDROP',
  bridge: 'BRIDGE',
  mint: 'MINT',
  nft_mint: 'NFT MINT',
  nft_transfer: 'NFT TRANSFER',
  liquidity: 'LIQUIDITY',
  nft_sale: 'ACCEPT BID',
  nft_buy: 'BUY NFT',
  nft_list: 'LIST NFT',
  nft_bid: 'NFT BID',
  other: 'OTHER',
};

const cn = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(' ');

const EXPLORER_TX_BASE = 'https://explorer.movementnetwork.xyz/txn';

const getTokenVisual = (symbol: string) => {
  const normalized = String(symbol || '').toUpperCase().replace(/\.E$/i, '').trim();
  const alias: Record<string, string> = {
    ETH: 'WETH',
    BTC: 'WBTC',
  };
  const key = alias[normalized] || normalized;
  return TOKEN_VISUALS[key] || TOKEN_VISUALS[normalized] || null;
};

const getBadgeClass = (type: string) => {
  const normalized = String(type || 'other').toLowerCase();
  if (normalized === 'swap') return styles.badgeSwap;
  if (normalized === 'nft_sale') return styles.badgeNftSale;
  if (normalized === 'nft_buy') return styles.badgeNftBuy;
  if (normalized === 'nft_list') return styles.badgeNftList;
  if (normalized === 'nft_bid') return styles.badgeNftBid;
  if (normalized === 'lend') return styles.badgeLend;
  if (normalized === 'borrow') return styles.badgeBorrow;
  if (normalized === 'repay') return styles.badgeRepay;
  if (normalized === 'stake') return styles.badgeStake;
  if (normalized === 'unstake') return styles.badgeUnstake;
  if (normalized === 'deposit') return styles.badgeDeposit;
  if (normalized === 'withdraw') return styles.badgeWithdraw;
  if (normalized === 'transfer' || normalized === 'send') return styles.badgeTransfer;
  if (normalized === 'received') return styles.badgeReceived;
  if (normalized === 'claim') return styles.badgeClaim;
  if (normalized === 'airdrop') return styles.badgeAirdrop;
  if (normalized === 'bridge') return styles.badgeBridge;
  if (normalized === 'liquidity') return styles.badgeLiquidity;
  if (normalized.includes('mint')) return styles.badgeMint;
  return styles.badgeOther;
};

const DappIcon = ({ tx }: { tx: any }) => {
  const dappNameRaw = String(tx?.dapp_name || '');
  const dappNameKey = dappNameRaw.toLowerCase().replace(/\s/g, '');
  const visual = (DEFI_PROTOCOL_VISUALS as any)[dappNameKey];

  const dappLogo = tx?.dapp_logo || visual?.logo;
  const rawType = String(tx?.tx_type || 'other').toLowerCase();

  const txBg = tx?.tx_bg || (rawType === 'send' || rawType === 'transfer' ? 'rgba(239,68,68,0.1)' : rawType === 'received' ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.1)');
  const txColor = tx?.tx_color || (rawType === 'send' || rawType === 'transfer' ? '#EF4444' : rawType === 'received' ? '#10B981' : 'inherit');

  if (dappLogo) {
    return (
      <span className={styles.dappIcon} aria-hidden="true">
        <img src={dappLogo} alt="" className={styles.dappIconImage} />
      </span>
    );
  }

  if (rawType === 'send' || rawType === 'transfer') {
    return (
      <span className={styles.typeIcon} style={{ background: txBg, color: txColor }} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="7 7 17 7 17 17"></polyline>
        </svg>
      </span>
    );
  }

  if (rawType === 'received') {
    return (
      <span className={styles.typeIcon} style={{ background: txBg, color: txColor }} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="17" y1="7" x2="7" y2="17"></line>
          <polyline points="17 17 7 17 7 7"></polyline>
        </svg>
      </span>
    );
  }

  const txIcon = tx?.tx_icon || (rawType === 'swap' ? '🔄' : '⚙️');

  return (
    <span className={styles.typeIcon} style={{ background: txBg, color: txColor }} aria-hidden="true">
      {txIcon}
    </span>
  );
};

const TokenIcon = ({ symbol }: { symbol: string }) => {
  const visual = getTokenVisual(symbol);
  const normalized = String(symbol || '').toUpperCase();
  const color = visual?.color || DEFAULT_TOKEN_COLOR;

  return (
    <span
      className={styles.tokenIcon}
      style={{
        '--token-primary': color.primary,
        '--token-secondary': color.secondary,
      } as any}
      aria-hidden="true"
    >
      {visual?.logo ? <img src={visual.logo} alt="" className={styles.tokenIconImage} /> : normalized.charAt(0) || '?'}
    </span>
  );
};

interface TransactionTableRowProps {
  tx: any;
  hideValues: boolean;
  onPlay: (tx: any) => void;
  onReport: (e: React.MouseEvent, tx: any) => void;
}

export default function TransactionTableRow({ tx, hideValues, onPlay, onReport }: TransactionTableRowProps) {
  const cleanHash = String(tx.tx_hash || '').replace(/^v/i, '');
  const txUrl = `${EXPLORER_TX_BASE}/${encodeURIComponent(cleanHash)}?network=mainnet`;
  const tokenIn = normalizeDisplayToken(tx.token_in);
  const tokenOut = normalizeDisplayToken(tx.token_out);
  const rawType = String(tx.tx_type || 'other').toLowerCase();

  const isSwap = rawType === 'swap';

  let hasTokenIn = Boolean(tokenIn?.label);
  let hasTokenOut = Boolean(tokenOut?.label);

  if (!isSwap) {
    if (['withdraw', 'unstake', 'claim', 'borrow', 'received', 'yield'].includes(rawType)) {
      if (hasTokenOut) {
        hasTokenIn = false;
      } else {
        hasTokenOut = false;
      }
    } else if (['lend', 'deposit', 'stake', 'repay', 'send'].includes(rawType)) {
      if (hasTokenIn) {
        hasTokenOut = false;
      } else {
        hasTokenIn = false;
      }
    } else if (tokenOut?.label === tokenIn?.label) {
      hasTokenOut = false;
    }
  }

  const displayAmounts = getDisplayAmounts(tx);
  const hasAmountIn = displayAmounts.length > 0;
  const hasAmountOut = displayAmounts.length > 1 && (isSwap || displayAmounts[1] !== displayAmounts[0]);

  const amountTone = getAmountTone(tx);
  const dappName = String(tx.dapp_name || 'Wallet');

  const typeLabel = TYPE_LABELS[rawType] || rawType.toUpperCase();
  const typeTitle = tx.dapp_contract
    ? `${dappName} · ${typeLabel} · ${tx.dapp_contract}`
    : `${dappName} · ${typeLabel}`;

  return (
    <tr className={styles.row}>
      <td>
        <div className={styles.typeCell} title={typeTitle}>
          <DappIcon tx={tx} />
          <div className={styles.typeMeta}>
            <div
              className={cn(styles.typeBadge, getBadgeClass(tx.tx_type))}
              style={tx.tx_color ? { color: tx.tx_color } : {}}
            >
              {typeLabel}
            </div>
            <span className={styles.typeDappName}>{dappName}</span>
          </div>
          <button
            type="button"
            className={styles.playbackButton}
            onClick={(e) => {
              e.stopPropagation();
              onPlay(tx);
            }}
            title="Visualize Transaction"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <circle cx="6" cy="6" r="2"></circle>
              <circle cx="6" cy="18" r="2"></circle>
              <circle cx="20" cy="12" r="2"></circle>
              <path d="M15 12h3"></path>
              <path d="M9.9 9.9L7.4 7.4"></path>
              <path d="M9.9 14.1l-2.5 2.5"></path>
            </svg>
          </button>
          <button
            type="button"
            className={styles.typeReportFlag}
            onClick={(e) => onReport(e, tx)}
            title="Report incorrect transaction data"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
        </div>
      </td>
      <td>
        <div className={styles.tokenPair}>
          {hasTokenIn ? (
            <div className={styles.tokenSide} title={tokenIn?.full}>
              <TokenIcon symbol={tokenIn?.full || ''} />
              <span>{tokenIn?.label}</span>
            </div>
          ) : null}
          {hasTokenIn && hasTokenOut ? <span className={styles.tokenArrow}>→</span> : null}
          {hasTokenOut ? (
            <div className={styles.tokenSide} title={tokenOut?.full}>
              <TokenIcon symbol={tokenOut?.full || ''} />
              <span>{tokenOut?.label}</span>
            </div>
          ) : null}
          {!hasTokenIn && !hasTokenOut ? <span className={styles.neutral}>—</span> : null}
        </div>
      </td>
      <td>
        <div className={styles.amountPair}>
          {hasAmountIn ? (
            <span
              className={styles[amountTone]}
              style={tx.badge_color ? { color: tx.badge_color } : {}}
            >
              {hideValues ? '*****' : formatAmount(displayAmounts[0])}
            </span>
          ) : null}
          {hasAmountIn && hasAmountOut ? <span className={styles.amountArrow}>→</span> : null}
          {hasAmountOut ? (
            <span
              className={styles[amountTone]}
              style={tx.badge_color ? { color: tx.badge_color } : {}}
            >
              {hideValues ? '*****' : formatAmount(displayAmounts[1])}
            </span>
          ) : null}
          {!hasAmountIn && !hasAmountOut ? <span className={styles.neutral}>—</span> : null}
        </div>
      </td>
      <td>{formatDateTime(tx.tx_timestamp)}</td>
      <td>
        <a
          href={txUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.hashLink}
        >
          {truncateHash(cleanHash)}
        </a>
      </td>
    </tr>
  );
}
