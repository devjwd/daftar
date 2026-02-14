import Swap from "../components/Swap";
import './Swap.css';

export default function SwapPage({ balances }) {
  return (
    <div className="swap-page">
      <Swap balances={balances} />
    </div>
  );
}
