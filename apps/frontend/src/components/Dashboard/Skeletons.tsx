import React from 'react';

export const SkeletonCard: React.FC<{ delay?: number }> = ({ delay = 0 }) => (
  <div
    className="token-card-new skeleton-card"
    style={{ animationDelay: `${delay}ms`, cursor: 'default' }}
  >
    <div className="token-card-glow" />
    <div className="token-card-content">
      <div className="token-card-left">
        <div className="token-logo-wrapper skeleton skeleton-circle" style={{ width: '40px', height: '40px', background: 'rgba(255, 255, 255, 0.05)' }} />
        <div className="token-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="skeleton skeleton-line" style={{ width: '60px', height: '12px' }} />
          <div className="skeleton skeleton-line" style={{ width: '80px', height: '16px' }} />
        </div>
      </div>
      <div className="token-card-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        <div className="skeleton skeleton-line" style={{ width: '70px', height: '16px' }} />
        <div className="skeleton skeleton-line" style={{ width: '50px', height: '12px' }} />
      </div>
    </div>
  </div>
);

export const LiquiditySkeleton: React.FC<{ delay?: number }> = ({ delay = 0 }) => (
  <div
    className="lp-card skeleton-card"
    style={{ animationDelay: `${delay}ms`, cursor: 'default' }}
  >
    <div className="lp-card-header">
      <div className="lp-card-logo skeleton"></div>
      <div className="lp-card-info">
        <div className="skeleton skeleton-line" style={{ width: '120px', height: '18px', marginBottom: '6px' }}></div>
        <div className="skeleton skeleton-line" style={{ width: '80px', height: '12px' }}></div>
      </div>
    </div>
    <div className="lp-card-body">
      <div className="lp-card-stats-row">
        <div className="lp-card-stat" style={{ border: 'none', background: 'rgba(255,255,255,0.03)' }}>
          <div className="skeleton skeleton-line" style={{ width: '40px', height: '10px', marginBottom: '8px' }}></div>
          <div className="skeleton skeleton-line" style={{ width: '70px', height: '16px' }}></div>
        </div>
        <div className="lp-card-stat" style={{ border: 'none', background: 'rgba(255,255,255,0.03)' }}>
          <div className="skeleton skeleton-line" style={{ width: '50px', height: '10px', marginBottom: '8px' }}></div>
          <div className="skeleton skeleton-line" style={{ width: '60px', height: '16px' }}></div>
        </div>
      </div>
      <div className="lp-card-details">
        <div className="lp-card-detail-row" style={{ border: 'none', background: 'rgba(255,255,255,0.02)' }}>
          <div className="skeleton skeleton-line" style={{ width: '60px', height: '10px' }}></div>
          <div className="skeleton skeleton-line" style={{ width: '100px', height: '10px' }}></div>
        </div>
        <div className="lp-card-detail-row" style={{ border: 'none', background: 'rgba(255,255,255,0.02)' }}>
          <div className="skeleton skeleton-line" style={{ width: '60px', height: '10px' }}></div>
          <div className="skeleton skeleton-line" style={{ width: '80px', height: '10px' }}></div>
        </div>
      </div>
    </div>
  </div>
);

export const DeFiSkeleton: React.FC<{ delay?: number }> = ({ delay = 0 }) => (
  <div
    className="defi-card-v2 is-compact skeleton-card"
    style={{ animationDelay: `${delay}ms`, cursor: 'default' }}
  >
    <div className="defi-v2-header">
      <div className="defi-v2-logo skeleton"></div>
      <div className="defi-v2-title">
        <div className="skeleton skeleton-line" style={{ width: '100px', height: '18px' }}></div>
      </div>
    </div>
    <div className="defi-v2-compact-body">
      <div className="defi-v2-net">
        <div className="skeleton skeleton-line" style={{ width: '60px', height: '10px' }}></div>
        <div className="skeleton skeleton-line" style={{ width: '80px', height: '16px' }}></div>
      </div>
    </div>
  </div>
);

export const NetWorthValueSkeleton: React.FC = () => (
  <>
    <div className="hero-networth-skeleton-value skeleton" aria-hidden="true"></div>
    <div className="hero-networth-skeleton-pill skeleton" aria-hidden="true"></div>
  </>
);

export const NetWorthMetaSkeleton: React.FC = () => (
  <div className="hero-networth-skeleton-meta" aria-hidden="true">
    <div className="hero-networth-skeleton-address-row">
      <div className="hero-networth-skeleton-line address skeleton"></div>
      <div className="hero-networth-skeleton-copy skeleton"></div>
    </div>
    <div className="hero-networth-skeleton-line bio skeleton"></div>
  </div>
);

export const NetWorthStatsSkeleton: React.FC = () => (
  <div className="hero-networth-skeleton-stats" aria-hidden="true">
    <div className="hero-networth-skeleton-stat">
      <div className="hero-networth-skeleton-stat-value skeleton"></div>
      <div className="hero-networth-skeleton-stat-label skeleton"></div>
    </div>
    <div className="hero-networth-skeleton-stat">
      <div className="hero-networth-skeleton-stat-value skeleton"></div>
      <div className="hero-networth-skeleton-stat-label skeleton"></div>
    </div>
    <div className="hero-networth-skeleton-stat compact">
      <div className="hero-networth-skeleton-stat-value small skeleton"></div>
      <div className="hero-networth-skeleton-stat-label skeleton"></div>
    </div>
  </div>
);
