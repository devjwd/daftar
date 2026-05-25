import React from 'react';
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { ArrowDownRight, ArrowUpRight, Ghost } from 'lucide-react';

interface ExchangeUsageDashboardProps {
  data: AnalyticsData;
}

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

const COLORS = [
  '#cda169', // Main Brand Gold
  '#b2854f', // Deep Bronze
  '#e5be8a', // Warm Amber
  '#895f2d', // Copper Brown
  '#f4d9b1', // Champagne
  '#6b5233'  // Deep Chocolate Earth
];

const ExchangeUsageDashboard: React.FC<ExchangeUsageDashboardProps> = ({ data }) => {
  const { deposits, withdrawals } = data.exchangeUsage;
  const hasDeposits = deposits.total > 0;
  const hasWithdrawals = withdrawals.total > 0;

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
    <div className="exchange-grid-v5">
      {/* Deposits Box */}
      <div className="bento-card">
        <div className="exchange-header-v5">
          <div>
            <h3 className="bento-title" style={{ marginBottom: 4 }}>
              <ArrowDownRight size={18} color="#36c690" />
              Deposits to Exchanges
            </h3>
            <span className="exchange-label">Volume In</span>
          </div>
          <span className="exchange-total">{formatVolumeValue(deposits.total)}</span>
        </div>

        {!hasDeposits ? (
          <div className="empty-state-v5">
            <Ghost size={32} className="empty-state-icon" />
            <p>No deposit activity found.</p>
          </div>
        ) : (
          <>
            <div style={{ height: '140px', margin: '0 -24px 24px -24px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={deposits.history}>
                  <defs>
                    <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#36c690" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#36c690" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={<CustomExchangeTooltip type="deposit" />} />
                  <Area type="monotone" dataKey="value" stroke="#36c690" strokeWidth={2} fill="url(#depGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
              <div style={{ width: '120px', height: '120px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                    <Pie data={deposits.breakdown} innerRadius={40} outerRadius={55} paddingAngle={4} dataKey="value" stroke="none">
                      {deposits.breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="entities-list-v5" style={{ flex: 1 }}>
                {deposits.breakdown.slice(0, 4).map((ex, i) => (
                  <div key={i} className="entity-row-v5" style={{ padding: '8px 12px' }}>
                    <div className="entity-left">
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }}></div>
                      <span className="entity-name">{ex.name}</span>
                    </div>
                    <span className="entity-value" style={{ fontSize: '13px' }}>{formatVolumeValue(ex.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Withdrawals Box */}
      <div className="bento-card">
        <div className="exchange-header-v5">
          <div>
            <h3 className="bento-title" style={{ marginBottom: 4 }}>
              <ArrowUpRight size={18} color="#7b68ee" />
              Withdrawals from Exchanges
            </h3>
            <span className="exchange-label">Volume Out</span>
          </div>
          <span className="exchange-total">{formatVolumeValue(withdrawals.total)}</span>
        </div>

        {!hasWithdrawals ? (
          <div className="empty-state-v5">
            <Ghost size={32} className="empty-state-icon" />
            <p>No withdrawal activity found.</p>
          </div>
        ) : (
          <>
            <div style={{ height: '140px', margin: '0 -24px 24px -24px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={withdrawals.history}>
                  <defs>
                    <linearGradient id="witGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7b68ee" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#7b68ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={<CustomExchangeTooltip type="withdrawal" />} />
                  <Area type="monotone" dataKey="value" stroke="#7b68ee" strokeWidth={2} fill="url(#witGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
              <div style={{ width: '120px', height: '120px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
                    <Pie data={withdrawals.breakdown} innerRadius={40} outerRadius={55} paddingAngle={4} dataKey="value" stroke="none">
                      {withdrawals.breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="entities-list-v5" style={{ flex: 1 }}>
                {withdrawals.breakdown.slice(0, 4).map((ex, i) => (
                  <div key={i} className="entity-row-v5" style={{ padding: '8px 12px' }}>
                    <div className="entity-left">
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length] }}></div>
                      <span className="entity-name">{ex.name}</span>
                    </div>
                    <span className="entity-value" style={{ fontSize: '13px' }}>{formatVolumeValue(ex.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ExchangeUsageDashboard;
