import React from 'react';
import { AnalyticsData } from '../../types/analytics.types';
import { Network, Coins, Ghost } from 'lucide-react';

interface TopEntitiesProps {
  data: AnalyticsData;
}

const TopEntities: React.FC<TopEntitiesProps> = ({ data }) => {
  const hasEntities = data.topEntities && data.topEntities.length > 0;
  const hasTokens = data.topTokens && data.topTokens.length > 0;

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
            {data.topEntities.slice(0, 6).map((entity, i) => (
              <div key={i} className="entity-row-v5">
                <div className="entity-left">
                  <div className="entity-avatar">
                    {entity.name.substring(0, 1).toUpperCase()}
                  </div>
                  <span className="entity-name">{entity.name}</span>
                </div>
                <span className="entity-value">${Math.abs(entity.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
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
            {data.topTokens.slice(0, 6).map((token, i) => (
              <div key={i} className="entity-row-v5">
                <div className="entity-left">
                  <div className="entity-avatar" style={{ background: 'rgba(205, 161, 105, 0.1)', color: 'var(--primary)' }}>
                    $
                  </div>
                  <span className="entity-name">{token.symbol}</span>
                </div>
                <span className="entity-value">${Math.abs(token.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TopEntities;
