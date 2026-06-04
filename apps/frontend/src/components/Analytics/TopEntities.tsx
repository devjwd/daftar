import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { Coins, Ghost, ArrowDownRight, ArrowUpRight, Network } from 'lucide-react';
import { DEFI_PROTOCOL_VISUALS, TOKEN_VISUALS, DEFAULT_PROTOCOL_VISUAL } from '../../config/display';

const COLORS = [
  '#cda169', // Main Brand Gold
  '#b2854f', // Deep Bronze
  '#e5be8a', // Warm Amber
  '#895f2d', // Copper Brown
  '#f4d9b1', // Champagne
  '#6b5233'  // Deep Chocolate Earth
];

const DEPOSIT_COLORS = [
  '#36c690', // Emerald Green
  '#00bfa6', // Teal
  '#20b2aa', // Light Sea Green
  '#008080', // Dark Teal
  '#a3e635'  // Lime Green
];

const WITHDRAWAL_COLORS = [
  '#7b68ee', // Slate/Medium Slate Blue
  '#a78bfa', // Lavender/Purple
  '#1e90ff', // Dodger Blue
  '#8a2be2', // Blue Violet
  '#ec4899'  // Pink/Magenta
];

interface TopEntitiesProps {
  data: AnalyticsData;
  timeframe: string;
  setTimeframe: (tf: string, startDate?: string, endDate?: string) => void;
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

const TopEntities: React.FC<TopEntitiesProps> = ({ data, timeframe, setTimeframe }) => {
  const [activeTab, setActiveTab] = useState<'exchange' | 'protocols' | 'tokens'>('exchange');
  const [showDropdown, setShowDropdown] = useState(false);

  // Custom Calendar state
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedStart, setSelectedStart] = useState<Date | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<Date | null>(null);
  const [inputStart, setInputStart] = useState('');
  const [inputEnd, setInputEnd] = useState('');

  const hasEntities = data.topEntities && data.topEntities.length > 0;
  const hasTokens = data.topTokens && data.topTokens.length > 0;

  const { deposits, withdrawals } = data.exchangeUsage;
  const hasDeposits = deposits.total > 0;
  const hasWithdrawals = withdrawals.total > 0;

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

  const formatDateString = (date: Date) => {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handleDayClick = (date: Date) => {
    if (!selectedStart || (selectedStart && selectedEnd)) {
      setSelectedStart(date);
      setSelectedEnd(null);
      setInputStart(formatDateString(date));
      setInputEnd('');
    } else {
      if (date < selectedStart) {
        setSelectedStart(date);
        setInputStart(formatDateString(date));
      } else {
        setSelectedEnd(date);
        setInputEnd(formatDateString(date));
      }
    }
  };

  const handleInputChange = (val: string, isStart: boolean) => {
    if (isStart) {
      setInputStart(val);
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        setSelectedStart(d);
        setCalMonth(d.getMonth());
        setCalYear(d.getFullYear());
      }
    } else {
      setInputEnd(val);
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        setSelectedEnd(d);
        setCalMonth(d.getMonth());
        setCalYear(d.getFullYear());
      }
    }
  };

  const handleClear = () => {
    setSelectedStart(null);
    setSelectedEnd(null);
    setInputStart('');
    setInputEnd('');
    setTimeframe('All');
    setShowDropdown(false);
  };

  const handleApply = () => {
    if (selectedStart && selectedEnd) {
      setTimeframe('Custom', selectedStart.toISOString(), selectedEnd.toISOString());
    } else if (selectedStart) {
      setTimeframe('Custom', selectedStart.toISOString(), selectedStart.toISOString());
    }
    setShowDropdown(false);
  };

  const getDateRangeString = () => {
    const allHistory = [...deposits.history, ...withdrawals.history];
    if (allHistory.length === 0) return 'NO EXCHANGE ACTIVITY';

    const sorted = allHistory.map(h => new Date(h.date)).sort((a, b) => a.getTime() - b.getTime());
    const minDate = sorted[0];
    const maxDate = sorted[sorted.length - 1];

    const timeDiff = Math.abs(maxDate.getTime() - minDate.getTime());
    const diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;

    const formatDate = (date: Date) => {
      return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' });
    };

    return `${formatDate(minDate)} - ${formatDate(maxDate)} (${diffDays} DAYS)`;
  };

  const getButtonText = () => {
    if (timeframe === 'Custom' && selectedStart) {
      const startStr = formatDateString(selectedStart);
      const endStr = selectedEnd ? formatDateString(selectedEnd) : 'End date';
      const daysCount = selectedEnd 
        ? Math.ceil(Math.abs(selectedEnd.getTime() - selectedStart.getTime()) / (1000 * 3600 * 24)) + 1
        : 1;
      return `${startStr} - ${endStr} (${daysCount} DAYS)`;
    }
    return getDateRangeString();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
      
      {/* UNIFIED BENTO CARD FOR ALL THREE WIDGETS */}
      <div className="bento-card" style={{ width: '100%' }}>
        
        {/* Navigation Tab Menu & Timeframe Filter */}
        <div className="analytics-tab-header">
          <div className="analytics-tab-header-left">
            <button 
              className={`analytics-tab-btn ${activeTab === 'exchange' ? 'active' : ''}`}
              onClick={() => setActiveTab('exchange')}
            >
              Exchange Usage
            </button>
            
            <button 
              className={`analytics-tab-btn ${activeTab === 'protocols' ? 'active' : ''}`}
              onClick={() => setActiveTab('protocols')}
            >
              Top Interacting Protocols
            </button>

            <button 
              className={`analytics-tab-btn ${activeTab === 'tokens' ? 'active' : ''}`}
              onClick={() => setActiveTab('tokens')}
            >
              Top Tokens Handled
            </button>
          </div>

          {/* Timeframe Selector & Custom Calendar Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            
            {/* Quick Timeframe Presets */}
            <div className="tabs-container-v5">
              {['1D', '1W', '1M', '3M', '1Y', 'All'].map(tf => (
                <button
                  key={tf}
                  className={`tab-v5 ${timeframe === tf ? 'active' : ''}`}
                  onClick={() => {
                    setTimeframe(tf);
                    // Clear custom calendar selection when clicking a standard preset
                    setSelectedStart(null);
                    setSelectedEnd(null);
                    setInputStart('');
                    setInputEnd('');
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Timeframe Filter Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                className={`analytics-filter-btn ${timeframe === 'Custom' ? 'active' : ''}`}
                onClick={() => setShowDropdown(prev => !prev)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                <span>{getButtonText()}</span>
                <span className="filter-arrow">▼</span>
              </button>

            {showDropdown && (
              <>
                <div 
                  className="analytics-filter-dropdown-overlay"
                  onClick={() => setShowDropdown(false)}
                />
                <div className="analytics-filter-dropdown">
                  {/* Inputs Row */}
                  <div className="analytics-filter-inputs">
                    <input 
                      className="analytics-filter-input"
                      type="text" 
                      placeholder="Start date" 
                      value={inputStart}
                      onChange={(e) => handleInputChange(e.target.value, true)}
                    />
                    <input 
                      className="analytics-filter-input"
                      type="text" 
                      placeholder="End date" 
                      value={inputEnd}
                      onChange={(e) => handleInputChange(e.target.value, false)}
                    />
                  </div>

                  {/* Weekdays Header */}
                  <div className="calendar-weekdays">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <span key={d} className="calendar-weekday">{d}</span>
                    ))}
                  </div>

                  {/* Month Name & Navigation */}
                  <div className="calendar-month-nav">
                    <span className="calendar-month-label">
                      {new Date(calYear, calMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </span>
                    <div className="calendar-nav-btns">
                      <button 
                        className="calendar-nav-btn"
                        onClick={() => {
                          if (calMonth === 0) {
                            setCalMonth(11);
                            setCalYear(prev => prev - 1);
                          } else {
                            setCalMonth(prev => prev - 1);
                          }
                        }}
                      >
                        &lt;
                      </button>
                      <button 
                        className="calendar-nav-btn"
                        onClick={() => {
                          if (calMonth === 11) {
                            setCalMonth(0);
                            setCalYear(prev => prev + 1);
                          } else {
                            setCalMonth(prev => prev + 1);
                          }
                        }}
                      >
                        &gt;
                      </button>
                    </div>
                  </div>

                  {/* Calendar Grid */}
                  <div className="calendar-grid">
                    {Array.from({ length: getFirstDayOfMonth(calYear, calMonth) }).map((_, idx) => (
                      <div key={`empty-${idx}`} />
                    ))}
                    {Array.from({ length: getDaysInMonth(calYear, calMonth) }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const thisDate = new Date(calYear, calMonth, dayNum);
                      const isStart = selectedStart && thisDate.toDateString() === selectedStart.toDateString();
                      const isEnd = selectedEnd && thisDate.toDateString() === selectedEnd.toDateString();
                      const isInRange = selectedStart && selectedEnd && thisDate > selectedStart && thisDate < selectedEnd;

                      const dayClass = [
                        'calendar-day',
                        isStart ? 'start' : '',
                        isEnd ? 'end' : '',
                        isInRange ? 'in-range' : ''
                      ].filter(Boolean).join(' ');

                      return (
                        <button
                          key={`day-${dayNum}`}
                          type="button"
                          className={dayClass}
                          onClick={() => handleDayClick(thisDate)}
                        >
                          {dayNum}
                        </button>
                      );
                    })}
                  </div>

                  {/* Actions Footer */}
                  <div className="calendar-footer">
                    <button className="calendar-footer-btn clear" onClick={handleClear} type="button">
                      Clear
                    </button>
                    <button className="calendar-footer-btn apply" onClick={handleApply} type="button">
                      Apply
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>
          </div>
        </div>

        {/* TAB CONTENTS */}
        {activeTab === 'exchange' && (
          <div>
            <div className="exchange-grid-v5-arkham" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
              
              {/* DEPOSITS COLUMN */}
              <div>
                <h4 className="exchange-section-title">DEPOSITS</h4>

                {!hasDeposits ? (
                  <div className="empty-state-v5" style={{ height: '240px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Ghost size={32} className="empty-state-icon" />
                    <p>No deposit activity found.</p>
                  </div>
                ) : (
                  <>
                    <div className="exchange-chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={deposits.history}>
                          <defs>
                            <linearGradient id="depGradArkham" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#36c690" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#36c690" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            orientation="left"
                            tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                            tickFormatter={(val) => {
                              if (val === 0) return '$0';
                              if (val >= 1000000) return `+$${(val / 1000000).toFixed(0)}M`;
                              if (val >= 1000) return `+$${(val / 1000).toFixed(0)}k`;
                              return `+$${val}`;
                            }}
                          />
                          <Tooltip content={<CustomExchangeTooltip type="deposit" />} />
                          <Area type="monotone" dataKey="value" stroke="#36c690" strokeWidth={2} fill="url(#depGradArkham)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="exchange-breakdown-row">
                      <div className="exchange-pie-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={deposits.breakdown} innerRadius={32} outerRadius={48} paddingAngle={3} dataKey="value" stroke="none">
                              {deposits.breakdown.map((_, i) => <Cell key={i} fill={DEPOSIT_COLORS[i % DEPOSIT_COLORS.length]} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="exchange-table-wrap">
                        <table className="exchange-table">
                          <thead>
                            <tr>
                              <th>Exchange</th>
                              <th style={{ textAlign: 'right' }}>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="total-row">
                              <td>Total</td>
                              <td className="exchange-val-cell">{formatVolumeValue(deposits.total)} (100%)</td>
                            </tr>
                            {deposits.breakdown.slice(0, 4).map((ex, i) => {
                              const pct = deposits.total > 0 ? Math.round((ex.value / deposits.total) * 100) : 0;
                              return (
                                <tr key={i}>
                                  <td>
                                    <div className="exchange-name-cell">
                                      <div className="exchange-color-dot" style={{ background: DEPOSIT_COLORS[i % DEPOSIT_COLORS.length] }} />
                                      <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{ex.name}</span>
                                    </div>
                                  </td>
                                  <td className="exchange-val-cell">
                                    {formatVolumeValue(ex.value)}<span className="exchange-pct">({pct}%)</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* WITHDRAWALS COLUMN */}
              <div>
                <h4 className="exchange-section-title">WITHDRAWALS</h4>

                {!hasWithdrawals ? (
                  <div className="empty-state-v5" style={{ height: '240px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Ghost size={32} className="empty-state-icon" />
                    <p>No withdrawal activity found.</p>
                  </div>
                ) : (
                  <>
                    <div className="exchange-chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={withdrawals.history}>
                          <defs>
                            <linearGradient id="witGradArkham" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#7b68ee" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#7b68ee" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            orientation="left"
                            tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                            tickFormatter={(val) => {
                              if (val === 0) return '$0';
                              if (val >= 1000000) return `+$${(val / 1000000).toFixed(0)}M`;
                              if (val >= 1000) return `+$${(val / 1000).toFixed(0)}k`;
                              return `+$${val}`;
                            }}
                          />
                          <Tooltip content={<CustomExchangeTooltip type="withdrawal" />} />
                          <Area type="monotone" dataKey="value" stroke="#7b68ee" strokeWidth={2} fill="url(#witGradArkham)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="exchange-breakdown-row">
                      <div className="exchange-pie-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={withdrawals.breakdown} innerRadius={32} outerRadius={48} paddingAngle={3} dataKey="value" stroke="none">
                              {withdrawals.breakdown.map((_, i) => <Cell key={i} fill={WITHDRAWAL_COLORS[i % WITHDRAWAL_COLORS.length]} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="exchange-table-wrap">
                        <table className="exchange-table">
                          <thead>
                            <tr>
                              <th>Exchange</th>
                              <th style={{ textAlign: 'right' }}>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="total-row">
                              <td>Total</td>
                              <td className="exchange-val-cell">{formatVolumeValue(withdrawals.total)} (100%)</td>
                            </tr>
                            {withdrawals.breakdown.slice(0, 4).map((ex, i) => {
                              const pct = withdrawals.total > 0 ? Math.round((ex.value / withdrawals.total) * 100) : 0;
                              return (
                                <tr key={i}>
                                  <td>
                                    <div className="exchange-name-cell">
                                      <div className="exchange-color-dot" style={{ background: WITHDRAWAL_COLORS[i % WITHDRAWAL_COLORS.length] }} />
                                      <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{ex.name}</span>
                                    </div>
                                  </td>
                                  <td className="exchange-val-cell">
                                    {formatVolumeValue(ex.value)}<span className="exchange-pct">({pct}%)</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* TOP INTERACTING PROTOCOLS TAB */}
        {activeTab === 'protocols' && (
          <div style={{ padding: '4px 0 8px 0' }}>
            {!hasEntities ? (
              <div className="empty-state-v5" style={{ minHeight: '280px' }}>
                <Ghost size={32} className="empty-state-icon" />
                <p>No protocol interactions found.</p>
              </div>
            ) : (
              <div className="entity-cards-grid">
                {data.topEntities.slice(0, 8).map((entity, i) => {
                  const visual = getProtocolVisual(entity.name);
                  return (
                    <div key={i} className="entity-row-v5">
                      <div className="entity-left">
                        <div className="entity-avatar" style={{ width: '40px', height: '40px' }}>
                          {visual.logo ? (
                            <img src={visual.logo} alt={entity.name} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                          ) : (
                            entity.name.substring(0, 1).toUpperCase()
                          )}
                        </div>
                        <div className="entity-info">
                          <span className="entity-name">{entity.name}</span>
                          <span className="entity-sub">
                            {entity.count ? `${entity.count} interactions` : 'DeFi Position'}
                          </span>
                        </div>
                      </div>
                      <span className="entity-value">{formatVolumeValue(entity.value)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TOP TOKENS HANDLED TAB */}
        {activeTab === 'tokens' && (
          <div style={{ padding: '4px 0 8px 0' }}>
            {!hasTokens ? (
              <div className="empty-state-v5" style={{ minHeight: '280px' }}>
                <Ghost size={32} className="empty-state-icon" />
                <p>No token transfers found.</p>
              </div>
            ) : (
              <div className="entity-cards-grid">
                {data.topTokens.slice(0, 8).map((token, i) => {
                  const visual = getTokenVisual(token.symbol);
                  return (
                    <div key={i} className="entity-row-v5">
                      <div className="entity-left">
                        <div className="entity-avatar" style={{ width: '40px', height: '40px', background: 'rgba(205, 161, 105, 0.1)', color: 'var(--primary)', fontSize: '16px' }}>
                          {visual.logo ? (
                            <img src={visual.logo} alt={token.symbol} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                          ) : (
                            '$'
                          )}
                        </div>
                        <div className="entity-info">
                          <span className="entity-name">{token.symbol}</span>
                          <span className="entity-sub">Asset Transferred</span>
                        </div>
                      </div>
                      <span className="entity-value">{formatVolumeValue(token.value)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

    </div>
  );
};

export default TopEntities;
