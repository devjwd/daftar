import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../utils/language';
import styles from './TrxHistory.module.css';

const PROTOCOL_OPTIONS = [
  'Mosaic', 'Echelon', 'Aries', 'Meridian', 'Route-X'
];

const TYPE_OPTIONS = [
  'SWAP', 'DEPOSIT', 'WITHDRAW', 'SEND', 'RECEIVE'
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
          <h2>{t(language, 'trxFilter') || 'Filter Transactions'}</h2>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.filterSection}>
            <h3>Type</h3>
            <div className={styles.pillContainer}>
              {TYPE_OPTIONS.map(type => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.filterPill} ${filters.exactTypes.includes(type) ? styles.filterPillActive : ''}`}
                  onClick={() => handleTypeToggle(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterSection}>
            <h3>Protocol</h3>
            <div className={styles.pillContainer}>
              {PROTOCOL_OPTIONS.map(protocol => (
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

          <div className={styles.filterRow}>
            <div className={styles.filterSection}>
              <h3>Amount</h3>
              <div className={styles.inputGroup}>
                <input 
                  type="number" 
                  placeholder="Min" 
                  value={filters.minAmount} 
                  onChange={e => setFilters({...filters, minAmount: e.target.value})}
                  className={styles.textInput}
                />
                <span>-</span>
                <input 
                  type="number" 
                  placeholder="Max" 
                  value={filters.maxAmount} 
                  onChange={e => setFilters({...filters, maxAmount: e.target.value})}
                  className={styles.textInput}
                />
              </div>
            </div>
            
            <div className={styles.filterSection}>
              <h3>Date</h3>
              <div className={styles.inputGroup}>
                <input 
                  type="date" 
                  value={filters.startDate} 
                  onChange={e => setFilters({...filters, startDate: e.target.value})}
                  className={styles.textInput}
                />
                <span>-</span>
                <input 
                  type="date" 
                  value={filters.endDate} 
                  onChange={e => setFilters({...filters, endDate: e.target.value})}
                  className={styles.textInput}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.clearButton} onClick={handleClear}>Clear</button>
          <button className={styles.applyButton} onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modalContent, document.body);
}
