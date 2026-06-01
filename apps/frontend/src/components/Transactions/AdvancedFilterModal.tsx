import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../utils/language';
import styles from './TrxHistory.module.css';

const TYPE_GROUPS = [
  {
    title: 'Transfers',
    options: ['SWAP', 'SEND', 'RECEIVED', 'BRIDGE']
  },
  {
    title: 'DeFi',
    options: ['LEND', 'BORROW', 'REPAY', 'DEPOSIT', 'WITHDRAW', 'LIQUIDITY']
  },
  {
    title: 'Yield',
    options: ['YIELD', 'CLAIM', 'STAKE', 'UNSTAKE']
  },
  {
    title: 'NFT & Contract',
    options: ['NFT_MINT', 'NFT_TRANSFER', 'OTHER']
  }
];

const PROTOCOL_GROUPS = [
  {
    title: 'DEX & Liquidity',
    options: ['Meridian', 'Route-X', 'Yuzu', 'Mosaic', 'ClobX', 'MMEX']
  },
  {
    title: 'Lending & Yield',
    options: ['MovePosition', 'Echelon', 'Joule', 'LayerBank', 'Canopy']
  },
  {
    title: 'Gaming & NFT',
    options: ['BRKT', 'Moversmap', 'CapyGo', 'Tradeport']
  },
  {
    title: 'Ecosystem',
    options: ['Avant', 'DoubleUp', 'Movement Core']
  }
];

export default function AdvancedFilterModal({ isOpen, onClose, initialFilters, onApply, language = 'en' }) {
  const [filters, setFilters] = useState(initialFilters || {
    protocols: [],
    exactTypes: [],
    minAmount: '',
    maxAmount: '',
    startDate: '',
    endDate: ''
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen) return null;

  const handleProtocolToggle = (protocol) => {
    setFilters(prev => ({
      ...prev,
      protocols: prev.protocols.includes(protocol)
        ? prev.protocols.filter(p => p !== protocol)
        : [...prev.protocols, protocol]
    }));
  };

  const handleTypeToggle = (type) => {
    setFilters(prev => ({
      ...prev,
      exactTypes: prev.exactTypes.includes(type)
        ? prev.exactTypes.filter(t => t !== type)
        : [...prev.exactTypes, type]
    }));
  };

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const handleClear = () => {
    const cleared = {
      protocols: [],
      exactTypes: [],
      minAmount: '',
      maxAmount: '',
      startDate: '',
      endDate: ''
    };
    setFilters(cleared);
    onApply(cleared);
    onClose();
  };

  const modalContent = (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitleGroup}>
            <div className={styles.modalIcon}>⚙️</div>
            <div>
              <h2>{t(language, 'advancedFilter') || 'Advanced Filters'}</h2>
              <p className={styles.modalSubtitle}>Refine your transaction history</p>
            </div>
          </div>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.filterSection}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>⚡</div>
              <h3>Transaction Type</h3>
            </div>
            
            {TYPE_GROUPS.map(group => (
              <div key={group.title} className={styles.filterGroup}>
                <div className={styles.filterGroupLabel}>{group.title}</div>
                <div className={styles.pillGrid}>
                  {group.options.map(type => (
                    <button
                      key={type}
                      type="button"
                      className={`${styles.filterPill} ${filters.exactTypes.includes(type) ? styles.filterPillActive : ''}`}
                      onClick={() => handleTypeToggle(type)}
                    >
                      {type.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.filterSection}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionIcon}>🌐</div>
              <h3>Protocol / dApp</h3>
            </div>
            
            {PROTOCOL_GROUPS.map(group => (
              <div key={group.title} className={styles.filterGroup}>
                <div className={styles.filterGroupLabel}>{group.title}</div>
                <div className={styles.pillGrid}>
                  {group.options.map(protocol => (
                    <button
                      key={protocol}
                      type="button"
                      className={`${styles.filterPill} ${filters.protocols.includes(protocol) ? styles.filterPillActive : ''}`}
                      onClick={() => handleProtocolToggle(protocol)}
                    >
                      {protocol}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.filterRow}>
            <div className={styles.filterSection}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>💰</div>
                <h3>Amount Range</h3>
              </div>
              <div className={styles.inputGroup}>
                <input
                  type="number"
                  placeholder="Min Amount"
                  value={filters.minAmount}
                  onChange={e => setFilters({ ...filters, minAmount: e.target.value })}
                  className={styles.textInput}
                />
                <span className={styles.inputDivider}>to</span>
                <input
                  type="number"
                  placeholder="Max Amount"
                  value={filters.maxAmount}
                  onChange={e => setFilters({ ...filters, maxAmount: e.target.value })}
                  className={styles.textInput}
                />
              </div>
            </div>

            <div className={styles.filterSection}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionIcon}>📅</div>
                <h3>Date Range</h3>
              </div>
              <div className={styles.inputGroup}>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                  className={styles.textInput}
                />
                <span className={styles.inputDivider}>to</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                  className={styles.textInput}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <div className={styles.activeFiltersCount}>
            {(filters.protocols.length + filters.exactTypes.length + (filters.minAmount ? 1 : 0) + (filters.maxAmount ? 1 : 0) + (filters.startDate ? 1 : 0) + (filters.endDate ? 1 : 0))} Active Filters
          </div>
          <div className={styles.footerActions}>
            <button className={styles.clearButton} onClick={handleClear}>Reset All</button>
            <button className={styles.applyButton} onClick={handleApply}>Apply Filters</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
