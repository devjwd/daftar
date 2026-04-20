import { useState, useCallback } from 'react';

/**
 * useTransactionTracker
 * 
 * Logic to track one or more sequential transactions.
 * Useful for the "Commit Queue" pattern in Admin settings.
 */
export function useTransactionTracker() {
  const [pendingTx, setPendingTx] = useState(null); // { id, hash, description, status: 'pending' | 'success' | 'error' }
  const [txHistory, setTxHistory] = useState([]);

  const trackTransaction = useCallback(async (description, txPromise) => {
    const id = Date.now().toString();
    const entry = { id, description, status: 'pending', hash: null };
    
    setPendingTx(entry);
    
    try {
      const result = await txPromise;
      // result is usually { hash: '0x...' } or Similar from useWallet
      const hash = result?.hash || result?.transaction_hash || null;
      
      const successEntry = { ...entry, status: 'success', hash };
      setPendingTx(successEntry);
      setTxHistory(prev => [successEntry, ...prev]);
      
      // Clear pending after 5 seconds
      setTimeout(() => setPendingTx(null), 5000);
      return result;
    } catch (error) {
      const errorEntry = { ...entry, status: 'error', error: error.message };
      setPendingTx(errorEntry);
      setTxHistory(prev => [errorEntry, ...prev]);
      
      // Stay on error state longer for visibility
      setTimeout(() => setPendingTx(null), 8000);
      throw error;
    }
  }, []);

  const clearPending = useCallback(() => setPendingTx(null), []);

  return {
    pendingTx,
    txHistory,
    trackTransaction,
    clearPending
  };
}
