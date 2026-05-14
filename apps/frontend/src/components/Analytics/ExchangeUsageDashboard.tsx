import React from 'react';
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AnalyticsData } from '../../types/analytics.types';
import { ArrowDownRight, ArrowUpRight, Ghost } from 'lucide-react';

interface ExchangeUsageDashboardProps {
  data: AnalyticsData;
}

const COLORS = ['#cda169', '#36c690', '#7b68ee', '#ff4b4b', '#ffa500', '#00ced1'];

const ExchangeUsageDashboard: React.FC<ExchangeUsageDashboardProps> = ({ data }) => {
  const { deposits, withdrawals } = data.exchangeUsage;
  const hasDeposits = deposits.total > 0;
  const hasWithdrawals = withdrawals.total > 0;

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
          <span className="exchange-total">${deposits.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
                    <span className="entity-value" style={{ fontSize: '13px' }}>${ex.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
          <span className="exchange-total">${withdrawals.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
                    <span className="entity-value" style={{ fontSize: '13px' }}>${ex.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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
