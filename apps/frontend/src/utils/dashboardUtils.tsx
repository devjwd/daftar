import React from 'react';
import { TOKEN_VISUALS, DEFI_PROTOCOL_VISUALS, DEFAULT_PROTOCOL_VISUAL, DEFAULT_TOKEN_COLOR } from '../config/display';
import { getTokenAddressBySymbol } from '../config/tokens';
import { resolveTokenPrice } from './price';

export const getTokenPriceFromMap = (symbol: string, priceMap: Record<string, number>) => {
  if (!priceMap) return null;

  const upperSymbol = (symbol || '').toUpperCase();
  const address = getTokenAddressBySymbol(upperSymbol);

  if (address && priceMap[address] !== undefined) {
    return Number(priceMap[address]) || 0;
  }

  if (['USDC', 'USDCX', 'USDT', 'USDA', 'USDE', 'SUSDE'].includes(upperSymbol)) {
    return 1;
  }

  return null;
};

export const getDeFiPositionUsdValue = (position: any, priceMap: Record<string, number>) => {
  if (!position) return null;

  if (Number.isFinite(position.usdValue) && position.usdValue > 0) {
    return position.usdValue;
  }

  const amount = parseFloat(position.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const tokenPrice = getTokenPriceFromMap(position.tokenSymbol, priceMap);
  if (tokenPrice === null) return null;

  return amount * tokenPrice;
};

export const getLiquidityPositionUsdValue = (position: any, priceMap: Record<string, number>) => {
  if (!position) return null;

  if (Number.isFinite(position.usdValue) && position.usdValue > 0) {
    return position.usdValue;
  }

  if (Number.isFinite(position.liquidityValue) && position.liquidityValue > 0) {
    return position.liquidityValue;
  }

  if (!priceMap) return null;

  const amount = parseFloat(position.amount) || 0;
  if (amount === 0) return 0;

  if (position.isNFT && position.protocol === 'yuzu') return null;
  if (position.isMeridianLP) return null;

  const price = resolveTokenPrice(priceMap, position.address, position.symbol, position.underlying);
  if (price > 0) return amount * price;

  return null;
};

export const humanizeAssetName = (raw: string) => {
  if (!raw || typeof raw !== 'string') return raw || 'Unknown';

  const FRIENDLY_NAMES: Record<string, string> = {
    'MERIDIAN_LP': 'Meridian LP Token',
    'MER-LP': 'Meridian LP Token',
    'MERIDIAN_POOL': 'Meridian Pool',
    'CANOPY_STAKING': 'Canopy Staking',
    'CANOPY_LP': 'Canopy LP',
    'YUZU_LP': 'Yuzu LP Token',
    'YUZ-LP': 'Yuzu LP Token',
    'MOVEMENT_STAKING': 'Movement Staking',
    'NATIVE_STAKING': 'Native Staking',
  };

  const upperRaw = raw.toUpperCase().trim();
  if (FRIENDLY_NAMES[upperRaw]) return FRIENDLY_NAMES[upperRaw];

  if (raw.includes('_') || raw === raw.toUpperCase()) {
    return raw
      .split(/[_-]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  return raw;
};

const LP_TOKEN_COLORS: Record<string, string> = {
  MOVE: '#cda169',
  USDC: '#2775ca',
  USDT: '#26a17b',
  ETH: '#627eea',
  WETH: '#627eea',
  BTC: '#f7931a',
  WBTC: '#f7931a',
  CAPY: '#ff6b9d',
  MOVECAT: '#9b59b6',
  LBTC: '#f7931a',
  EZETH: '#00d395',
  RSETH: '#4caf50',
  SOLVBTC: '#f7931a',
  USDE: '#171717',
  USDA: '#2196f3',
  WEETH: '#7c3aed',
  USDCX: '#2775ca',
  SUSDE: '#ffffff',
};

export const getTokenTextColor = (rawSymbol: string) => {
  if (!rawSymbol) return null;
  const normalized = rawSymbol
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '');

  const withoutSuffix = normalized.replace(/\.E$/i, '');
  const withoutCvPrefix = withoutSuffix.replace(/^CV/, '');
  const withoutLPrefix = withoutCvPrefix.replace(/^L/, '');

  return (
    LP_TOKEN_COLORS[withoutLPrefix] ||
    LP_TOKEN_COLORS[withoutCvPrefix] ||
    LP_TOKEN_COLORS[withoutSuffix] ||
    LP_TOKEN_COLORS[normalized] ||
    null
  );
};

export const renderColoredTokenText = (value: string) => {
  if (typeof value !== 'string' || !value) return value;

  const pieces = value.split(/(\s+|\/|\+|,|:|\(|\))/g).filter((piece) => piece !== '');
  const NON_TOKEN_WORDS = new Set(['LP', 'TOKEN', 'POSITION', 'NOT', 'AVAILABLE', 'ASSET']);

  return pieces.map((piece, index) => {
    const trimmed = piece.trim();
    if (!trimmed) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

    const normalized = trimmed.replace(/[^A-Za-z0-9.]/g, '');
    const hasLetters = /[A-Za-z]/.test(normalized);
    if (!hasLetters) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

    const upper = normalized.toUpperCase();
    if (NON_TOKEN_WORDS.has(upper)) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

    const color = getTokenTextColor(upper);
    if (!color) return <React.Fragment key={`lp-txt-${index}`}>{piece}</React.Fragment>;

    return (
      <span key={`lp-txt-${index}`} className="lp-token-colored" style={{ color }}>
        {piece}
      </span>
    );
  });
};

export const TokenIcon: React.FC<{ symbol: string; size?: number }> = ({ symbol, size = 16 }) => {
  const baseSymbol = String(symbol || '').toUpperCase().replace(/\.E$/i, '').replace(/^CV/, '').replace(/^L/, '');
  const visual = TOKEN_VISUALS[baseSymbol] || TOKEN_VISUALS[symbol?.toUpperCase()] || null;
  const logo = visual?.logo || null;

  if (logo) {
    return (
      <img
        src={logo}
        alt={symbol}
        className="token-mini-icon"
        style={{ width: size, height: size, borderRadius: '4px', marginRight: '6px', objectFit: 'contain' }}
        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
      />
    );
  }
  return null;
};

export const getAssetChange = (address: string, symbol: string, priceChanges: Record<string, number>) => {
  if (!priceChanges || Object.keys(priceChanges).length === 0) return undefined;

  // 1. Normalize address (shorten 0x00...001 to 0x1)
  const normalizedInput = String(address || '').toLowerCase().replace(/^0x0+/, "0x");
  let change = priceChanges[normalizedInput];

  // 2. Try exact address match if normalized failed
  if (change === undefined && address) {
    change = priceChanges[address.toLowerCase()];
  }

  // 3. Fallback to Symbol-based matching (especially for MOVE, ETH, BTC)
  if (change === undefined) {
    const upperSymbol = String(symbol || '').toUpperCase();
    const isMove = upperSymbol === 'MOVE' || upperSymbol.includes('MOVE');
    
    if (isMove) {
      // Return 0 if we know it's MOVE but have no change data, to ensure it's "counted" in totalWeightValue
      return priceChanges["0xa"] !== undefined ? priceChanges["0xa"] : (priceChanges["0x1"] !== undefined ? priceChanges["0x1"] : 0);
    } else if (upperSymbol === 'ETH' || upperSymbol.includes('ETHER')) {
      change = priceChanges["0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376"];
    } else if (upperSymbol === 'BTC' || upperSymbol.includes('BITCOIN')) {
      change = priceChanges["0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c"];
    }
  }

  return change;
};

export const processBalances = (
  indexerBalances: any[],
  priceMap: Record<string, number>,
  allPositions: any[]
) => {
  return indexerBalances.map(balance => {
    const price = resolveTokenPrice(priceMap, balance.address, balance.symbol, balance.fullType);
    const usdValue = balance.numericAmount * price;

    let formattedValue;
    if (usdValue > 0 && usdValue < 0.01) {
      formattedValue = `$${usdValue.toLocaleString(undefined, {
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      })}`;
    } else if (usdValue > 0 && usdValue < 1) {
      formattedValue = `$${usdValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })}`;
    } else {
      formattedValue = `$${usdValue.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }

    return { ...balance, usdValue, price, formattedValue };
  }).filter(b => {
    const symbol = (b.symbol || '').toUpperCase();
    const isInternalToken =
      symbol.includes('DROPS') ||
      symbol.includes('CVWBTC') ||
      symbol.includes('LWBTC') ||
      symbol.includes('IMOVE') ||
      symbol.includes('IWBTC') ||
      symbol.includes('DMOVE') ||
      symbol.includes('LMOVE');

    if (isInternalToken) return false;

    // Deduplicate: If a token is already counted in DeFi/Liquidity positions, exclude it from Wallet
    const isCountedInDeFi = allPositions.some(p => {
      if (!p || !p.type) return false;

      // ONLY deduplicate known receipt/staking tokens
      const isReceiptToken =
        symbol.includes('MOVE') && (symbol.startsWith('ST') || symbol.startsWith('G') || symbol.startsWith('L') || symbol.startsWith('C')) ||
        symbol.includes('ETH') && (symbol.startsWith('ST') || symbol.startsWith('EZ') || symbol.startsWith('RS')) ||
        symbol.startsWith('L') || symbol.startsWith('LB') || symbol.startsWith('CV') || symbol.startsWith('I');

      if (!isReceiptToken) return false;

      const matchesAddress = b.address && p.address && b.address === p.address;
      const matchesSymbol = b.symbol && p.tokenSymbol && b.symbol === p.tokenSymbol;
      return (matchesAddress || matchesSymbol) && (p.type === 'Liquidity' || p.type === 'Lending' || p.type === 'Staking');
    });

    if (isCountedInDeFi) return false;

    return b.usdValue > 0 || b.isKnown;
  }).sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
};

export const getPrecisionDecimals = (value: number): number => {
  const absVal = Math.abs(value);
  if (absVal > 0 && absVal < 0.01) return 6;
  if (absVal > 0 && absVal < 1) return 4;
  return 2;
};
