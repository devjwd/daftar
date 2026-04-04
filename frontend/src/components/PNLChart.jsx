import React, { useEffect, useId, useMemo, useState } from 'react';

import styles from './PNLChart.module.css';

const PERIODS = [
  { label: '1D', value: 'today', days: 1 },
  { label: '1W', value: '7d', days: 7 },
  { label: '1M', value: '30d', days: 30 },
  { label: '3M', value: '90d', days: 90 },
];

const PERIOD_QUERY_MAP = {
  today: 'today',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
};

const EMPTY_PNL = {
  byDay: [],
  txCount: 0,
};

const SPARKLINE_WIDTH = 360;
const SPARKLINE_HEIGHT = 118;
const SPARKLINE_PADDING = 10;

const cn = (...parts) => parts.filter(Boolean).join(' ');

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  const absolute = Math.abs(amount);

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: absolute >= 1000 ? 0 : 2,
    maximumFractionDigits: absolute >= 1000 ? 0 : 2,
  }).format(amount);
};

const buildDailySeries = (byDay, activePeriod) => {
  const periodConfig = PERIODS.find((item) => item.value === activePeriod) || PERIODS[1];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pnlByDate = new Map(
    (Array.isArray(byDay) ? byDay : []).map((item) => [String(item?.date || ''), Number(item?.pnl || 0)])
  );

  const points = [];
  let cumulative = 0;

  for (let offset = periodConfig.days - 1; offset >= 0; offset -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - offset);
    const dateKey = current.toISOString().slice(0, 10);
    const dailyPnl = Number(pnlByDate.get(dateKey) || 0);
    cumulative += dailyPnl;

    points.push({
      cumulativePnl: cumulative,
      dailyPnl,
    });
  }

  if (points.length === 1) {
    points.push({ ...points[0] });
  }

  return points;
};

const buildSparklineGeometry = (points) => {
  if (!points.length) {
    return null;
  }

  const values = points.map((point) => Number(point?.cumulativePnl || 0));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const usableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
  const usableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;

  const mapped = points.map((point, index) => {
    const x = SPARKLINE_PADDING + (usableWidth * index) / Math.max(points.length - 1, 1);
    const y = SPARKLINE_PADDING + ((maxValue - Number(point?.cumulativePnl || 0)) / range) * usableHeight;

    return { x, y };
  });

  const linePath = mapped
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const firstPoint = mapped[0];
  const lastPoint = mapped[mapped.length - 1];
  const baseline = SPARKLINE_HEIGHT - SPARKLINE_PADDING;

  return {
    areaPath: `${linePath} L ${lastPoint.x.toFixed(2)} ${baseline.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baseline.toFixed(2)} Z`,
    linePath,
    lastPoint,
  };
};

const LoadingState = () => (
  <div className={styles.skeleton} aria-hidden="true">
    <div className={styles.skeletonChart} />
    <div className={styles.skeletonTabs}>
      <span className={styles.skeletonTab} />
      <span className={styles.skeletonTab} />
      <span className={styles.skeletonTab} />
      <span className={styles.skeletonTab} />
    </div>
  </div>
);

export default function PNLChart({ walletAddress, className = '' }) {
  const [activePeriod, setActivePeriod] = useState('7d');
  const [pnlData, setPnlData] = useState(EMPTY_PNL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const gradientId = useId();

  useEffect(() => {
    if (!walletAddress) {
      setPnlData(EMPTY_PNL);
      setLoading(false);
      setError('');
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;

    const fetchPnl = async () => {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({
          wallet: walletAddress,
          period: PERIOD_QUERY_MAP[activePeriod] || '7d',
        });
        const response = await fetch(`/api/pnl?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`PNL request failed (${response.status})`);
        }

        const json = await response.json();
        if (!disposed) {
          setPnlData({
            ...EMPTY_PNL,
            ...json,
          });
        }
      } catch (fetchError) {
        if (fetchError?.name === 'AbortError') {
          return;
        }

        console.error('Failed to fetch PNL data:', fetchError);
        if (!disposed) {
          setError('Unable to load PNL right now');
          setPnlData(EMPTY_PNL);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void fetchPnl();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [activePeriod, walletAddress]);

  const chartPoints = useMemo(
    () => buildDailySeries(pnlData?.byDay || [], activePeriod),
    [activePeriod, pnlData]
  );
  const sparkline = useMemo(() => buildSparklineGeometry(chartPoints), [chartPoints]);
  const activeLabel = PERIODS.find((period) => period.value === activePeriod)?.label || '1W';
  const currentValue = Number(chartPoints[chartPoints.length - 1]?.cumulativePnl || 0);
  const shouldHide = !walletAddress || error || (!loading && Number(pnlData?.txCount || 0) === 0);

  if (shouldHide) {
    return null;
  }

  if (loading) {
    return (
      <section className={cn(styles.chartOnly, className)}>
        <LoadingState />
      </section>
    );
  }

  return (
    <section className={cn(styles.chartOnly, className)}>
      <div className={styles.chartShell}>
        <div className={styles.sparklineFrame}>
          <svg
            className={styles.sparkline}
            viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
            role="img"
            aria-label={`${activeLabel} PNL trend ${formatCurrency(currentValue)}`}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d7b07c" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#d7b07c" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`M ${SPARKLINE_PADDING} ${SPARKLINE_HEIGHT - SPARKLINE_PADDING} H ${SPARKLINE_WIDTH - SPARKLINE_PADDING}`}
              className={styles.baseline}
            />
            {sparkline && <path d={sparkline.areaPath} fill={`url(#${gradientId})`} />}
            {sparkline && <path d={sparkline.linePath} className={styles.sparklineStroke} />}
            {sparkline?.lastPoint && (
              <circle
                cx={sparkline.lastPoint.x}
                cy={sparkline.lastPoint.y}
                r="3.5"
                className={styles.sparklinePoint}
              />
            )}
          </svg>
        </div>

        <div className={styles.periodTabs}>
          {PERIODS.map((period) => (
            <button
              key={period.value}
              type="button"
              className={cn(styles.periodTab, activePeriod === period.value && styles.periodTabActive)}
              onClick={() => setActivePeriod(period.value)}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}