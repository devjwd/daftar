import React from 'react';
import { getTokenInfo } from '../../config/tokens';
import { TOKEN_VISUALS, DEFAULT_TOKEN_COLOR } from '../../config/display';
import { t } from '../../utils/language';

interface Token {
  address: string;
  symbol: string;
  amount: string;
  formattedValue?: string;
  numericAmount?: number;
}

interface TokenCardProps {
  token: Token;
  delay: number;
  convertUSD?: (val: number) => number;
  formatCurrencyValue?: (val: number) => string;
  language: string;
  hideValues?: boolean;
}

const TokenCard: React.FC<TokenCardProps> = ({ 
  token, 
  delay, 
  convertUSD, 
  formatCurrencyValue, 
  language, 
  hideValues 
}) => {
  const tokenInfo = getTokenInfo(token.address);
  const rawSymbol = String(tokenInfo?.symbol || token.symbol || '').trim();
  const symbol = rawSymbol.toUpperCase();
  const baseSymbol = symbol.replace(/\.E$/i, '');
  const visual = TOKEN_VISUALS[baseSymbol] || TOKEN_VISUALS[symbol] || null;
  const tokenLogo = visual?.logo || null;
  const tokenColor = visual?.color || DEFAULT_TOKEN_COLOR;
  const displayName = tokenInfo?.name || rawSymbol || t(language, 'dashToken');
  const displayMeta = rawSymbol || 'Movement';

  const usdValueNum = parseFloat(token.formattedValue?.replace('$', '').replace(',', '') || '0');
  const hasValue = usdValueNum > 0;

  const convertedValue = convertUSD ? convertUSD(usdValueNum) : usdValueNum;
  const displayValue = hideValues ? '***' : (formatCurrencyValue ? formatCurrencyValue(convertedValue) : `$${usdValueNum.toFixed(2)}`);

  const HIGH_VALUE_COINS = ['ETH', 'WETH', 'BTC', 'WBTC', 'LBTC', 'EZETH', 'RSETH', 'SOLVBTC', 'WEETH'];
  const isHighValueCoin = HIGH_VALUE_COINS.some(coin => baseSymbol.includes(coin));
  const formattedAmount = hideValues ? '*****' : (isHighValueCoin
    ? (token.numericAmount || parseFloat(token.amount) || 0).toFixed(7)
    : token.amount);

  return (
    <div
      className="token-card-new"
      style={{
        animationDelay: `${delay}ms`,
        // @ts-ignore
        '--token-color': tokenColor.primary,
        '--token-color-light': tokenColor.secondary,
      }}
    >
      <div className="token-card-glow" />

      <div className="token-card-content">
        <div className="token-card-left">
          <div className={`token-logo-wrapper ${tokenLogo ? 'has-image' : ''}`}>
            {tokenLogo ? (
              <img
                src={tokenLogo}
                alt={displayName}
                className="token-logo"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLElement).parentElement?.classList.remove('has-image');
                }}
              />
            ) : (
              <span className="token-initial">{symbol.charAt(0) || '?'}</span>
            )}
          </div>

          <div className="token-info">
            <span className="token-network">{displayMeta}</span>
            <span className="token-symbol">{displayName}</span>
          </div>
        </div>

        <div className="token-card-right">
          <span className="token-balance">{formattedAmount}</span>
          <span className={`token-value ${hasValue ? 'has-value' : ''}`}>
            {displayValue}
          </span>
        </div>
      </div>

      <div className="token-card-accent" />
    </div>
  );
};

export default TokenCard;
