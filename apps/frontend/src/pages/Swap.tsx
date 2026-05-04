import { useEffect } from 'react';
import Swap from "../components/Swap";
import './Swap.css';

export default function SwapPage({ balances, onSwapSuccess }) {
  useEffect(() => {
    // Lock scroll on mount
    document.body.style.overflow = 'hidden';
    
    // Restore on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <div className="swap-page">
      <Swap balances={balances} onSwapSuccess={onSwapSuccess} />
    </div>
  );
}
