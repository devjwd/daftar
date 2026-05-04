import React from 'react';

interface StakingCardProps {
  name: string;
  value: string;
  type: string;
  delay: number;
}

const StakingCard: React.FC<StakingCardProps> = ({ name, value, type, delay }) => (
  <div
    className="card staking-card"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="icon-square"></div>
    <div className="staking-info">
      <span className="staking-name">{name}</span>
      <span className="staking-value" style={{ fontSize: '14px', opacity: 0.8 }}>{type}: {value}</span>
    </div>
  </div>
);

export default StakingCard;
