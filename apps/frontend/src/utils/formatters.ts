export const parseTimestampDate = (value: any) => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value}Z`
      : value;
    return new Date(normalized);
  }

  return new Date(value);
};

export const formatAmount = (value: any) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: amount !== 0 && Math.abs(amount) < 1 ? 2 : 0,
    maximumFractionDigits: 4,
  }).format(amount);
};

export const hasPositiveDisplayNumber = (value: any) => Number.isFinite(Number(value)) && Number(value) > 0;

export const getAmountTone = (tx: any) => {
  const hasAmountIn = hasPositiveDisplayNumber(tx?.amount_in);
  const hasAmountOut = hasPositiveDisplayNumber(tx?.amount_out);

  if (hasAmountIn && !hasAmountOut) {
    return 'negative';
  }

  if (hasAmountOut && !hasAmountIn) {
    return 'positive';
  }

  return 'neutral';
};

export const getDisplayAmounts = (tx: any) => {
  const txType = String(tx?.tx_type || 'other').toLowerCase();
  const amountIn = tx?.amount_in;
  const amountOut = tx?.amount_out;
  const hasAmountIn = hasPositiveDisplayNumber(amountIn);
  const hasAmountOut = hasPositiveDisplayNumber(amountOut);

  if (['lend', 'deposit', 'repay', 'send'].includes(txType)) {
    return hasAmountIn ? [amountIn] : hasAmountOut ? [amountOut] : [];
  }

  if (txType === 'stake') {
    if (hasAmountIn && hasAmountOut) {
      return [amountIn, amountOut];
    }

    return hasAmountIn ? [amountIn] : hasAmountOut ? [amountOut] : [];
  }

  if (['withdraw', 'unstake', 'claim', 'borrow', 'received', 'yield'].includes(txType)) {
    return hasAmountOut ? [amountOut] : hasAmountIn ? [amountIn] : [];
  }

  if (txType === 'swap') {
    const output = [];
    if (hasAmountIn) output.push(amountIn);
    if (hasAmountOut) output.push(amountOut);
    return output;
  }

  const output = [];
  if (hasAmountIn) output.push(amountIn);
  if (hasAmountOut) output.push(amountOut);
  return output;
};

export const shortenTokenLabel = (value: any) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  if (/^0x[a-f0-9]{12,}$/i.test(normalized)) {
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`.toUpperCase();
  }

  if (normalized.length > 18) {
    return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`.toUpperCase();
  }

  return normalized.toUpperCase();
};

export const normalizeDisplayToken = (value: any) => {
  const normalized = String(value || '').trim();
  return normalized
    ? {
      label: shortenTokenLabel(normalized),
      full: normalized.toUpperCase(),
    }
    : null;
};

export const formatDateTime = (value: any) => {
  const date = parseTimestampDate(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.floor(diffMs / (60 * 1000));

    if (totalMinutes <= 0) {
      return 'just now';
    }

    if (totalMinutes < 60) {
      return `${totalMinutes} min ago`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (minutes === 0) {
      return `${hours} hr ago`;
    }

    return `${hours} hr ${minutes} min ago`;
  }

  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${datePart} · ${timePart}`;
};

export const truncateHash = (value: any) => {
  const hash = String(value || '');
  if (hash.length <= 14) {
    return hash || '—';
  }

  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};
