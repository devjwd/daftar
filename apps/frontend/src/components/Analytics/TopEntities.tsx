import React, { useState } from 'react';
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Coins, Ghost, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { DEFI_PROTOCOL_VISUALS, TOKEN_VISUALS, DEFAULT_PROTOCOL_VISUAL } from '../../config/display';

const COLORS = [
  '#cda169', // Main Brand Gold
  '#b2854f', // Deep Bronze
  '#e5be8a', // Warm Amber
  '#895f2d', // Copper Brown
  '#f4d9b1', // Champagne
  '#6b5233'  // Deep Chocolate Earth
];

const CustomExchangeTooltip = ({ active, payload, type }: any) => {
  if (!active || !payload || !payload.length) return null;

  const point = payload[0].payload;
  const dateStr = point.date;

  const d = new Date(dateStr);
  const formattedDate = isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  const value = payload[0].value;
  const isDeposit = type === 'deposit';
  const themeColor = isDeposit ? '#36c690' : '#7b68ee';
  const labelText = isDeposit ? 'Cumulative Deposits' : 'Cumulative Withdrawals';
  const dailyLabelText = isDeposit ? 'Daily Volume In' : 'Daily Volume Out';
  const prefix = isDeposit ? '-' : '+';

  const formatVolumeValue = (val: number): string => {
    const absVal = Math.abs(val);
    if (absVal === 0) return '$0';
    if (absVal < 0.001) return `$${val.toFixed(6)}`;
    if (absVal < 0.01) return `$${val.toFixed(4)}`;
    if (absVal < 1) return `$${val.toFixed(3)}`;
    if (absVal < 10) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  const renderDetailsList = (details: Array<{ name: string; value: number; tokenString?: string }>, prefix: string, color: string) => {
    if (!details || details.length === 0) return null;
    return (
      <div style={{ marginTop: '6px' }}>
        {details.map((detail, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'rgba(255,255,255,0.7)', paddingLeft: '8px', margin: '2px 0' }}>
            <span>• {detail.name}</span>
            <span style={{ color, fontWeight: 700 }}>
              {prefix}{formatVolumeValue(detail.value)}
              {detail.tokenString && (
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginLeft: '4px' }}>
                  ({detail.tokenString})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  };

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
      color: '#fff',
      zIndex: 100
    }}>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
        {formattedDate}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
          {labelText}
        </span>
        <span style={{
          fontSize: '14px',
          fontWeight: 900,
          color: themeColor
        }}>
          {formatVolumeValue(value)}
        </span>
      </div>

      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '8px 0' }}></div>

      <div>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontWeight: 800, marginBottom: '6px' }}>
          Daily Breakdown
        </div>

        {point && (Number(point.dailyValue || 0) > 0) ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: themeColor, fontWeight: 700 }}>
              <span>{dailyLabelText}</span>
              <span>
                {prefix}{formatVolumeValue(point.dailyValue)}
                {point.dailyTokenString && (
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginLeft: '4px' }}>
                    ({point.dailyTokenString})
                  </span>
                )}
              </span>
            </div>
            {renderDetailsList(point.details || [], prefix, themeColor)}
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', textAlign: 'center', padding: '4px 0' }}>
            No exchange activity
          </div>
        )}
      </div>
    </div>
  );
};

interface TopEntitiesProps {
  data: AnalyticsData;
}

const TopEntities: React.FC<TopEntitiesProps> = ({ data }) => {
  const [activeExchangeTab, setActiveExchangeTab] = useState<'deposits' | 'withdrawals'>('deposits');
  const hasTokens = data.topTokens && data.topTokens.length > 0;

  const { deposits, withdrawals } = data.exchangeUsage;
  const isDeposit = activeExchangeTab === 'deposits';
  const activeStats = isDeposit ? deposits : withdrawals;
  const hasExchangeActivity = activeStats.total > 0;
  const themeColor = isDeposit ? '#36c690' : '#7b68ee';

  const getProtocolVisual = (name: string) => {
    const key = name.toLowerCase().replace(/\s/g, '');
    return (DEFI_PROTOCOL_VISUALS as any)[key] || DEFAULT_PROTOCOL_VISUAL;
  };

  const getTokenVisual = (symbol: string) => {
    return (TOKEN_VISUALS as any)[symbol] || { logo: null };
  };

  const formatVolumeValue = (val: number): string => {
    const absVal = Math.abs(val);
    if (absVal === 0) return '$0';
    if (absVal < 0.001) return `$${val.toFixed(6)}`;
    if (absVal < 0.01) return `$${val.toFixed(4)}`;
    if (absVal < 1) return `$${val.toFixed(3)}`;
    if (absVal < 10) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="overview-grid-v5" style={{ marginTop: '24px' }}>
      <div className="bento-card" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 className="bento-title" style={{ margin: 0 }}>
            {isDeposit ? <ArrowDownRight size={18} color="#36c690" /> : <ArrowUpRight size={18} color="#7b68ee" />}
            Exchange Flows
          </h3>
          <div className="tabs-container-v5" style={{ margin: 0, padding: '4px' }}>
            <button
              className={`tab-v5 ${activeExchangeTab === 'deposits' ? 'active' : ''}`}
              onClick={() => setActiveExchangeTab('deposits')}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              Deposits
            </button>
            <button
              className={`tab-v5 ${activeExchangeTab === 'withdrawals' ? 'active' : ''}`}
              onClick={() => setActiveExchangeTab('withdrawals')}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              Withdrawals
            </button>
          </div>
        </div>

        <div className="exchange-header-v5" style={{ marginBottom: '16px' }}>
          <div>
            <span className="exchange-label">{isDeposit ? 'Volume In' : 'Volume Out'}</span>
          </div>
          <span className="exchange-total" style={{ fontSize: '24px' }}>{formatVolumeValue(activeStats.total)}</span>
        </div>
        
        {!hasExchangeActivity ? (
          <div className="empty-state-v5" style={{ height: '240px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Ghost size={32} className="empty-state-icon" />
            <p>No exchange activity found.</p>
          </div>
        ) : (
          <>
            <div style={{ height: '140px', margin: '0 -24px 20px -24px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeStats.history}>
                  <defs>
                    <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={themeColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={themeColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={<CustomExchangeTooltip type={isDeposit ? "deposit" : "withdrawal"} />} />
                  <Area type="monotone" dataKey="value" stroke={themeColor} strokeWidth={2} fill="url(#activeGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div style={{ width: '100px', height: '100px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={activeStats.breakdown} innerRadius={30} outerRadius={42} paddingAngle={4} dataKey="value" stroke="none">
                      {activeStats.breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="entities-list-v5" style={{ flex: 1, gap: '6px' }}>
                {activeStats.breakdown.slice(0, 3).map((ex, i) => (
                  <div key={i} className="entity-row-v5" style={{ padding: '6px 12px', borderRadius: '8px' }}>
                    <div className="entity-left">
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS[i % COLORS.length] }}></div>
                      <span className="entity-name" style={{ fontSize: '13px' }}>{ex.name}</span>
                    </div>
                    <span className="entity-value" style={{ fontSize: '12px' }}>{formatVolumeValue(ex.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bento-card">
        <h3 className="bento-title">
          <Coins size={18} className="bento-icon" />
          Top Tokens Handled
        </h3>
        
        {!hasTokens ? (
          <div className="empty-state-v5">
            <Ghost size={32} className="empty-state-icon" />
            <p>No token transfers found.</p>
          </div>
        ) : (
          <div className="entities-list-v5">
            {data.topTokens.slice(0, 6).map((token, i) => {
              const visual = getTokenVisual(token.symbol);
              return (
                <div key={i} className="entity-row-v5">
                  <div className="entity-left">
                    <div className="entity-avatar" style={{ background: 'rgba(205, 161, 105, 0.1)', color: 'var(--primary)' }}>
                      {visual.logo ? (
                        <img src={visual.logo} alt={token.symbol} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                      ) : (
                        '$'
                      )}
                    </div>
                    <span className="entity-name">{token.symbol}</span>
                  </div>
                  <span className="entity-value">{formatVolumeValue(token.value)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TopEntities;
