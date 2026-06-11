import React, { useState, useEffect, useMemo } from 'react';
import styles from './YieldCalculator.module.css';
import { getDeFiPositionUsdValue } from '../../utils/dashboardUtils';
import { resolveTokenPrice } from '../../utils/price';

interface ProtocolApy {
  id: string;
  protocol: string;
  pool_name: string;
  pool_address: string;
  apy: number;
}

interface YieldCalculatorProps {
  visibleDeFiPositions?: any[];
  visibleStakingPositions?: any[];
  priceMap?: any;
  convertUSD?: (val: number) => number;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

export const YieldCalculator: React.FC<YieldCalculatorProps> = ({
  visibleDeFiPositions = [],
  visibleStakingPositions = [],
  priceMap = {},
  convertUSD = (val: number) => val,
}) => {
  const [apys, setApys] = useState<ProtocolApy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('1000');

  useEffect(() => {
    const fetchApys = async () => {
      try {
        const response = await fetch(`${API_BASE}/apys`);
        if (!response.ok) throw new Error('Failed to fetch APY data');
        const result = await response.json();
        
        if (result.success && result.data) {
          setApys(result.data);
          if (result.data.length > 0) {
            setSelectedPoolId(result.data[0].id);
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load Yield Calculator');
      } finally {
        setLoading(false);
      }
    };

    fetchApys();
  }, []);

  const selectedPool = useMemo(() => {
    return apys.find(p => p.id === selectedPoolId) || null;
  }, [apys, selectedPoolId]);

  // When a pool is selected, try to auto-fill the deposit amount with the user's actual balance
  useEffect(() => {
    if (!selectedPool) return;

    let userUsdBalance = 0;

    // Check DeFi positions (e.g. Echelon)
    const matchingDeFi = visibleDeFiPositions.filter(p => 
      p.protocolName?.toLowerCase() === selectedPool.protocol.toLowerCase() &&
      p.name?.toLowerCase() === selectedPool.pool_name.toLowerCase() &&
      p.type !== 'Debt'
    );
    
    matchingDeFi.forEach(pos => {
      const usdValue = getDeFiPositionUsdValue(pos, priceMap) ?? 0;
      userUsdBalance += convertUSD(usdValue);
    });

    // Check Staking positions (e.g. Canopy / Native)
    const matchingStaking = visibleStakingPositions.filter(p => 
      p.protocolName?.toLowerCase() === selectedPool.protocol.toLowerCase() ||
      p.name?.toLowerCase() === selectedPool.pool_name.toLowerCase()
    );
    
    matchingStaking.forEach(pos => {
      const movePrice = resolveTokenPrice(priceMap, '0xa', 'MOVE');
      const usdValue = pos.amount * movePrice;
      userUsdBalance += convertUSD(usdValue);
    });

    if (userUsdBalance > 0) {
      setDepositAmount(userUsdBalance.toFixed(2));
    } else {
      setDepositAmount('1000'); // Default if no balance
    }
  }, [selectedPoolId, selectedPool, visibleDeFiPositions, visibleStakingPositions, priceMap, convertUSD]);

  const returns = useMemo(() => {
    const amount = parseFloat(depositAmount) || 0;
    if (!selectedPool || amount <= 0) return null;

    const yearly = amount * selectedPool.apy;
    const monthly = yearly / 12;
    const weekly = yearly / 52;
    const daily = yearly / 365;

    return { daily, weekly, monthly, yearly };
  }, [selectedPool, depositAmount]);

  if (loading) {
    return <div className={styles.container}><div className={styles.loading}>Loading live APY data...</div></div>;
  }

  if (error || apys.length === 0) {
    return null; 
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Yield Calculator</h3>
        <div className={styles.badge}>Daftar Pro</div>
      </div>

      <div className={styles.controls}>
        <div className={styles.inputGroup}>
          <label className={styles.label}>Select Protocol/Pool</label>
          <select 
            className={styles.select}
            value={selectedPoolId}
            onChange={(e) => setSelectedPoolId(e.target.value)}
          >
            {apys.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.protocol} - {pool.pool_name} ({(pool.apy * 100).toFixed(2)}% APY)
              </option>
            ))}
          </select>
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.label}>Deposit Amount (USD)</label>
          <input 
            type="number"
            className={styles.input}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="e.g. 1000"
            min="0"
          />
        </div>
      </div>

      {returns && (
        <div className={styles.resultsGrid}>
          <div className={styles.resultCard}>
            <span className={styles.resultPeriod}>Daily</span>
            <span className={styles.resultValue}>+${returns.daily.toFixed(2)}</span>
          </div>
          <div className={styles.resultCard}>
            <span className={styles.resultPeriod}>Weekly</span>
            <span className={styles.resultValue}>+${returns.weekly.toFixed(2)}</span>
          </div>
          <div className={styles.resultCard}>
            <span className={styles.resultPeriod}>Monthly</span>
            <span className={styles.resultValue}>+${returns.monthly.toFixed(2)}</span>
          </div>
          <div className={styles.resultCard}>
            <span className={styles.resultPeriod}>Yearly</span>
            <span className={styles.resultValue}>+${returns.yearly.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
