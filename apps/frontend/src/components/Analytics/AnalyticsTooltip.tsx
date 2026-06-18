import React from 'react';

interface TooltipPoint {
  date: string;
  value: number;
  holdings?: Array<{ symbol: string; amount: number }>;
  inflow?: number;
  inflowDetails?: Array<{ name: string; value: number }>;
  outflow?: number;
  outflowDetails?: Array<{ name: string; value: number }>;
}

interface AnalyticsTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TooltipPoint; value: number }>;
  activeChartTab: 'balance' | 'flow' | 'txs';
  formatVolumeValue: (val: number) => string;
}

export default function AnalyticsTooltip({ active, payload, activeChartTab, formatVolumeValue }: AnalyticsTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const point = payload[0].payload;
  const dateStr = point.date;

  const d = new Date(dateStr);
  const formattedDate = isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  const value = payload[0].value;

  const renderDetailsList = (details: Array<{ name: string; value: number }>, prefix: string, color: string) => {
    if (!details || details.length === 0) return null;
    return (
      <div style={{ marginTop: '6px' }}>
        {details.map((detail, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.7)', paddingLeft: '8px', margin: '2px 0' }}>
            <span>• {detail.name}</span>
            <span style={{ color, fontWeight: 700 }}>
              {prefix}{formatVolumeValue(detail.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderHoldingsList = (holdings: Array<{ symbol: string; amount: number }>) => {
    if (!holdings || holdings.length === 0) {
      return (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
          No tokens held
        </div>
      );
    }
    return (
      <div style={{ marginTop: '6px' }}>
        {holdings.map((h, idx) => {
          const displayAmount = h.amount > 0 && h.amount < 0.0001
            ? h.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 })
            : h.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
            
          return (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.7)', paddingLeft: '8px', margin: '2px 0' }}>
              <span>• {h.symbol}</span>
              <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
                {displayAmount === '0' && h.amount > 0 ? '< 0.00000001' : displayAmount}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const holdings = point.holdings || [];

  return (
    <div style={{
      background: 'rgba(15, 15, 15, 0.85)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(205, 161, 105, 0.2)',
      borderRadius: '12px',
      padding: '12px 16px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
      maxWidth: '300px',
      minWidth: '220px',
      color: '#fff'
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
        {formattedDate}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
          {activeChartTab === 'balance' ? 'Token Balance' : activeChartTab === 'flow' ? 'Cumulative Volume' : 'Transactions'}
        </span>
        <span style={{
          fontSize: '14px',
          fontWeight: 900,
          color: activeChartTab === 'txs' ? '#36c690' : 'var(--primary)'
        }}>
          {activeChartTab === 'txs' ? Number(value).toLocaleString() : formatVolumeValue(value)}
        </span>
      </div>

      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '8px 0' }}></div>

      <div>
        {activeChartTab === 'balance' ? (
          <>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: '6px' }}>
              Token Holdings Snapshot
            </div>
            {renderHoldingsList(holdings)}
          </>
        ) : (
          <>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: '6px' }}>
              Daily Transfers
            </div>

            {point && (Number(point.inflow || 0) > 0 || Number(point.outflow || 0) > 0) ? (
              <>
                {Number(point.inflow || 0) > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#36c690', fontWeight: 700 }}>
                      <span>Received (Inflow)</span>
                      <span>+{formatVolumeValue(point.inflow || 0)}</span>
                    </div>
                    {renderDetailsList(point.inflowDetails || [], '+', '#36c690')}
                  </div>
                )}

                {Number(point.outflow || 0) > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ff4b4b', fontWeight: 700 }}>
                      <span>Sent (Outflow)</span>
                      <span>-{formatVolumeValue(point.outflow || 0)}</span>
                    </div>
                    {renderDetailsList(point.outflowDetails || [], '-', '#ff4b4b')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
                No deposits or withdrawals
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
