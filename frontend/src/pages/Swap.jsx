import Swap from "../components/Swap";
import './Swap.css';

export default function SwapPage({ balances, onSwapSuccess }) {
  return (
    <div className="swap-page">
      <Swap balances={balances} onSwapSuccess={onSwapSuccess} />
    </div>
  );
}
