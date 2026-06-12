import React from 'react';
import { DEFI_PROTOCOL_VISUALS, DEFAULT_PROTOCOL_VISUAL } from '../../config/display';
import { t } from '../../utils/language';
import { TokenIcon, renderColoredTokenText, getDeFiPositionUsdValue, getPrecisionDecimals } from '../../utils/dashboardUtils';

interface DeFiPositionCardProps {
  protocolPositions: any[];
  delay: number;
  priceMap: Record<string, number>;
  convertUSD: (val: number) => number;
  formatCurrencyValue: (val: number, currency?: string, decimals?: number) => string;
  currencySymbol: string;
  language: string;
  hideValues?: boolean;
  isExpanded?: boolean;
}

const DeFiPositionCard: React.FC<DeFiPositionCardProps> = ({
  protocolPositions,
  delay,
  priceMap,
  convertUSD,
  formatCurrencyValue,
  currencySymbol,
  language,
  hideValues,
  isExpanded
}) => {
  const [apys, setApys] = React.useState<any[]>([]);

  React.useEffect(() => {
    const apiBase = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';
    fetch(`${apiBase}/apys`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setApys(data);
      })
      .catch(console.error);
  }, []);

  if (!protocolPositions || protocolPositions.length === 0) return null;

  const firstPos = protocolPositions[0];

  const handleReportClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const event = new CustomEvent('open-bug-report', {
      detail: {
        type: 'token',
        symbol: protocol.name || firstPos.protocolName || '',
        address: firstPos.protocolWebsite || firstPos.poolAddress || firstPos.id || ''
      }
    });
    window.dispatchEvent(event);
  };

  const getProtocolKey = () => {
    const searchText = `${firstPos.name} ${firstPos.protocolName || ''} ${firstPos.resourceType || ''}`.toLowerCase();
    for (const key of Object.keys(DEFI_PROTOCOL_VISUALS)) {
      if (searchText.includes(key)) return key;
    }
    return null;
  };

  const protocolKey = getProtocolKey();
  const protocol = protocolKey
    ? DEFI_PROTOCOL_VISUALS[protocolKey]
    : { ...DEFAULT_PROTOCOL_VISUAL, name: firstPos.protocolName || DEFAULT_PROTOCOL_VISUAL.name };

  const supplyPositions = protocolPositions.filter(p => p.type === 'Lending' || p.type === 'Staking' || p.type === 'Liquidity');
  const debtPositions = protocolPositions.filter(p => p.type === 'Debt');

  const formatValue = (val: any) => {
    if (hideValues) return '*****';
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const formatUsdValue = (val: any) => {
    if (hideValues) return '*****';
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return formatCurrencyValue(0);
    const converted = convertUSD(num);
    if (converted >= 1000000) return `${currencySymbol}${(converted / 1000000).toFixed(2)}M`;
    if (converted >= 1000) return `${currencySymbol}${(converted / 1000).toFixed(2)}K`;
    return formatCurrencyValue(converted, undefined, getPrecisionDecimals(converted));
  };

  const getPositionUsdValue = (pos: any) => {
    return getDeFiPositionUsdValue(pos, priceMap) ?? 0;
  };

  const isMovementNativeStaking = (pos: any) => {
    const protocolName = String(pos?.protocolName || "").toLowerCase();
    const name = String(pos?.name || "").toLowerCase();
    const source = String(pos?.source || "").toLowerCase();

    return (
      protocolName.includes("movement native staking") ||
      name.includes("movement native staking") ||
      source === "view"
    );
  };

  const formatNativeStakingMeta = (pos: any) => {
    if (!isMovementNativeStaking(pos)) return null;

    const pool = String(pos?.poolAddress || "").toLowerCase();
    const poolSuffix = pool.startsWith("0x") && pool.length > 10 ? `...${pool.slice(-6)}` : null;

    const pendingStakeRaw = Number(pos?.pendingStakeAmount || 0);
    const pendingWithdrawalRaw = Number(pos?.pendingWithdrawalAmount || 0);
    const pendingMove = (pendingStakeRaw + pendingWithdrawalRaw) / 100000000;

    const poolPart = poolSuffix ? `Pool ${poolSuffix}` : null;
    const pendingPart = pendingMove > 0 ? `Pending ${formatValue(pendingMove)} MOVE` : null;

    if (poolPart && pendingPart) return `${poolPart} - ${pendingPart}`;
    return poolPart || pendingPart;
  };

  const totalSupplyUsd = supplyPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const totalDebtUsd = debtPositions.reduce((sum, p) => sum + getPositionUsdValue(p), 0);
  const netUsd = totalSupplyUsd - totalDebtUsd;
  const positionTypeLabel = supplyPositions.length > 0 && debtPositions.length > 0
    ? `${t(language, 'dashSupplied')} & ${t(language, 'dashBorrowed')}`
    : supplyPositions.length > 0 ? t(language, 'dashSupplied') : t(language, 'dashBorrowed');

  const maxApy = apys
    .filter(a => a.protocol.toLowerCase().includes((protocol.name || '').toLowerCase()))
    .reduce((max, a) => Math.max(max, a.apy), 0);

  const getApyForPosition = (pos: any) => {
    const apyMatch = apys.find(a => 
      a.protocol.toLowerCase().includes((protocol.name || '').toLowerCase()) &&
      (a.pool_name.toLowerCase().includes((pos.tokenSymbol || '').toLowerCase()) || 
       a.pool_address.toLowerCase() === (pos.poolAddress || '').toLowerCase())
    );
    return apyMatch ? apyMatch.apy : null;
  };

  return (
    <div
      className={`defi-card-v2 ${isExpanded ? 'is-expanded' : 'is-compact'}`}
      style={{ animationDelay: `${delay}ms`, '--protocol-color': protocol.color } as React.CSSProperties}
    >
      <div className="defi-v2-header">
        <div className="defi-v2-logo">
          <img
            src={protocol.logo}
            alt={protocol.name}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.src = '/movement-logo.svg';
            }}
          />
        </div>
        <div className="defi-v2-title">
          <h3>{protocol.name}</h3>
          {firstPos.protocolWebsite ? (
            <a
              href={firstPos.protocolWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="defi-v2-type-link"
              title={`Visit ${protocol.name}`}
            >
              {firstPos.protocolWebsite.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          ) : (
            <span className="defi-v2-type">{positionTypeLabel}</span>
          )}
        </div>
        <div className="defi-v2-action-group">
          <button
            type="button"
            className="defi-v2-report-flag"
            onClick={handleReportClick}
            title="Report incorrect DeFi data"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
          </button>
          {firstPos.protocolWebsite && (
            <a href={firstPos.protocolWebsite} target="_blank" rel="noopener noreferrer" className="defi-v2-link" aria-label={`Open ${protocol.name} website`} title="Open protocol website">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      </div>

      {!isExpanded ? (
        <div className="defi-v2-compact-body">
          <div className="defi-v2-net">
            <span className="defi-v2-net-label">{t(language, 'dashNetPosition')}</span>
            <span className={`defi-v2-net-value ${netUsd >= 0 ? 'positive' : 'negative'}`}>
              {netUsd >= 0 ? '+' : ''}{formatUsdValue(netUsd)}
            </span>
          </div>
          {maxApy > 0 && (
            <div className="defi-v2-net" style={{ marginLeft: '16px' }}>
              <span className="defi-v2-net-label">Est. Yield</span>
              <span className="defi-v2-net-value positive" style={{ color: '#00C950' }}>
                {maxApy.toFixed(2)}% APY
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="defi-v2-columns">
            <div className="defi-v2-column supply">
              <div className="defi-v2-column-header">
                <span className="defi-v2-column-label">{t(language, 'dashSupplied')}</span>
                <span className="defi-v2-column-total">{formatUsdValue(totalSupplyUsd)}</span>
              </div>
              <div className="defi-v2-column-items">
                {supplyPositions.length > 0 ? supplyPositions.map((pos, idx) => (
                  <div key={idx} className="defi-v2-item">
                    <div className="defi-v2-item-token-wrap">
                      <TokenIcon symbol={pos.tokenSymbol} />
                      <span className="defi-v2-item-token">
                        {renderColoredTokenText(pos.tokenSymbol || 'Token')}
                      </span>
                      {getApyForPosition(pos) !== null && (
                        <span className="defi-v2-item-meta" style={{ color: '#00C950', background: 'rgba(0,201,80,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px' }}>
                          {getApyForPosition(pos)?.toFixed(2)}% APY
                        </span>
                      )}
                      {formatNativeStakingMeta(pos) && (
                        <span className="defi-v2-item-meta">{formatNativeStakingMeta(pos)}</span>
                      )}
                    </div>
                    <div className="defi-v2-item-values">
                      <span className="defi-v2-item-amount supply">{formatValue(pos.value)}</span>
                      <span className="defi-v2-item-usd">{formatUsdValue(getPositionUsdValue(pos))}</span>
                    </div>
                  </div>
                )) : (
                  <div className="defi-v2-empty">{t(language, 'dashNoSupply')}</div>
                )}
              </div>
            </div>

            <div className="defi-v2-column borrow">
              <div className="defi-v2-column-header">
                <span className="defi-v2-column-label">{t(language, 'dashBorrowed')}</span>
                <span className="defi-v2-column-total debt">{formatUsdValue(totalDebtUsd)}</span>
              </div>
              <div className="defi-v2-column-items">
                {debtPositions.length > 0 ? debtPositions.map((pos, idx) => (
                  <div key={idx} className="defi-v2-item">
                    <div className="defi-v2-item-token-wrap">
                      <TokenIcon symbol={pos.tokenSymbol} />
                      <span className="defi-v2-item-token">
                        {renderColoredTokenText(pos.tokenSymbol || 'Token')}
                      </span>
                    </div>
                    <div className="defi-v2-item-values">
                      <span className="defi-v2-item-amount debt">-{formatValue(pos.value)}</span>
                      <span className="defi-v2-item-usd debt">-{formatUsdValue(getPositionUsdValue(pos))}</span>
                    </div>
                  </div>
                )) : (
                  <div className="defi-v2-empty">{t(language, 'dashNoDebt')}</div>
                )}
              </div>
            </div>
          </div>

          <div className="defi-v2-footer">
            <div className="defi-v2-net">
              <span className="defi-v2-net-label">{t(language, 'dashNetPosition')}</span>
              <span className={`defi-v2-net-value ${netUsd >= 0 ? 'positive' : 'negative'}`}>
                {netUsd >= 0 ? '+' : ''}{formatUsdValue(netUsd)}
              </span>
            </div>
            {debtPositions.length > 0 && totalSupplyUsd > 0 && (
              <div className="defi-v2-health">
                <span className="defi-v2-health-label">{t(language, 'dashHealth')}</span>
                <div className="defi-v2-health-bar">
                  <div
                    className="defi-v2-health-fill"
                    style={{
                      width: `${Math.min(100, Math.max(10, 100 - (totalDebtUsd / totalSupplyUsd) * 100))}%`,
                      background: protocol.gradient
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(DeFiPositionCard);
