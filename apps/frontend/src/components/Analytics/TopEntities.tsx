import React from 'react';
import { AnalyticsData } from '../../types/analytics.types';
import { Network, Coins, Ghost } from 'lucide-react';
import { DEFI_PROTOCOL_VISUALS, TOKEN_VISUALS, DEFAULT_PROTOCOL_VISUAL } from '../../config/display';

interface TopEntitiesProps {
  data: AnalyticsData;
}

const TopEntities: React.FC<TopEntitiesProps> = ({ data }) => {
  const hasEntities = data.topEntities && data.topEntities.length > 0;
  const hasTokens = data.topTokens && data.topTokens.length > 0;

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
      <div className="bento-card">
        <h3 className="bento-title">
          <Network size={18} className="bento-icon" />
          Top Interacting Protocols
        </h3>
        
        {!hasEntities ? (
          <div className="empty-state-v5">
            <Ghost size={32} className="empty-state-icon" />
            <p>No protocol interactions found.</p>
          </div>
        ) : (
          <div className="entities-list-v5">
            {data.topEntities.slice(0, 6).map((entity, i) => {
              const visual = getProtocolVisual(entity.name);
              return (
                <div key={i} className="entity-row-v5">
                  <div className="entity-left">
                    <div className="entity-avatar">
                      {visual.logo ? (
                        <img src={visual.logo} alt={entity.name} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                      ) : (
                        entity.name.substring(0, 1).toUpperCase()
                      )}
                    </div>
                    <span className="entity-name">{entity.name}</span>
                  </div>
                  <span className="entity-value">{formatVolumeValue(entity.value)}</span>
                </div>
              );
            })}
          </div>
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
