import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../../hooks/useProfile';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { AnalyticsData } from '../../types/analytics.types';
import { resolveEffectiveTier, isPremiumTier } from '../../utils/subscription';
import { useAnalyticsSync } from '../../hooks/useAnalyticsSync';

import SyncStateOverlay from './SyncStateOverlay';
import AnalyticsOverview from './AnalyticsOverview';
import PlanGate from '../PlanGate';
import { Download, ChevronDown, FileText, Table, Activity, RefreshCw } from 'lucide-react';
import AnalyticsSkeleton from './AnalyticsSkeleton';

import './AnalyticsV5.css';

interface AnalyticsViewProps {
  walletAddress?: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ walletAddress }) => {
  const navigate = useNavigate();
  const { account, signMessage } = useWallet();
  const [timeframe, setTimeframe] = useState('All');
  const [bottomTimeframe, setBottomTimeframe] = useState('All');
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [bottomAnalyticsData, setBottomAnalyticsData] = useState<AnalyticsData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportTimeframe, setExportTimeframe] = useState('all');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDownloadDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { profile, loading: profileLoading } = useProfile(walletAddress || null);
  const subscriptionTier = resolveEffectiveTier({
    subscription_tier: profile?.subscription_tier,
    subscription_expires_at: profile?.subscription_expires_at,
    is_verified: profile?.is_verified,
  });
  const isPremium = isPremiumTier(subscriptionTier);

  const API_URL = (import.meta as any).env?.VITE_API_URL || '';

  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const bottomTimeframeRef = useRef(bottomTimeframe);
  useEffect(() => {
    bottomTimeframeRef.current = bottomTimeframe;
  }, [bottomTimeframe]);

  const getConnectedAddress = useCallback(() => {
    if (!account?.address) return null;
    return (
      typeof account.address === 'string'
        ? account.address
        : (account.address as { toString?: () => string })?.toString?.()
    )?.toLowerCase() || null;
  }, [account?.address]);

  const fetchAnalyticsData = useCallback(
    async (tf = timeframeRef.current, bottomTf = bottomTimeframeRef.current) => {
      if (!walletAddress) return;

      const cacheKeyGlobal = `analytics_cache_${walletAddress.toLowerCase()}_${tf}`;
      const cacheKeyBottom = `analytics_cache_${walletAddress.toLowerCase()}_${bottomTf}`;

      // 1. Try to load Stale (cached) data first for 0ms page load
      try {
        const cachedGlobal = localStorage.getItem(cacheKeyGlobal);
        const cachedBottom = localStorage.getItem(cacheKeyBottom);
        if (cachedGlobal && cachedBottom) {
          setAnalyticsData(JSON.parse(cachedGlobal));
          setBottomAnalyticsData(JSON.parse(cachedBottom));
        } else if (cachedGlobal) {
          setAnalyticsData(JSON.parse(cachedGlobal));
          setBottomAnalyticsData(JSON.parse(cachedGlobal));
        }
      } catch (cacheErr) {
        console.warn('Failed to parse browser analytics cache:', cacheErr);
      }

      setDataLoading(true);
      try {
        if (tf === bottomTf) {
          const res = await fetch(
            `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`
          );
          if (!res.ok) {
            if (res.status === 403) {
              setFetchError('Analytics require an active Pro subscription for this profile.');
              return;
            }
            throw new Error('Failed to load analytics');
          }
          const data = await res.json();
          setAnalyticsData(data);
          setBottomAnalyticsData(data);
          setFetchError(null);

          // Save to browser cache
          try {
            localStorage.setItem(cacheKeyGlobal, JSON.stringify(data));
            localStorage.setItem(cacheKeyBottom, JSON.stringify(data));
          } catch {}
        } else {
          const [resGlobal, resBottom] = await Promise.all([
            fetch(
              `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`
            ),
            fetch(
              `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(bottomTf)}`
            ),
          ]);
          if (!resGlobal.ok || !resBottom.ok) {
            if (resGlobal.status === 403 || resBottom.status === 403) {
              setFetchError('Analytics require an active Pro subscription for this profile.');
              return;
            }
            throw new Error('Failed to load analytics');
          }
          const dataGlobal = await resGlobal.json();
          const dataBottom = await resBottom.json();
          setAnalyticsData(dataGlobal);
          setBottomAnalyticsData(dataBottom);
          setFetchError(null);

          // Save to browser cache
          try {
            localStorage.setItem(cacheKeyGlobal, JSON.stringify(dataGlobal));
            localStorage.setItem(cacheKeyBottom, JSON.stringify(dataBottom));
          } catch {}
        }

        // Clean up old cached items for other wallets to prevent quota exceeded errors
        try {
          const currentWalletPrefix = `analytics_cache_${walletAddress.toLowerCase()}_`;
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('analytics_cache_') && !key.startsWith(currentWalletPrefix)) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));
        } catch {}
      } catch (err) {
        console.error('Fetch analytics error:', err);
        setFetchError('Unable to load analytics right now.');
      } finally {
        setDataLoading(false);
      }
    },
    [walletAddress, API_URL]
  );

  const handleSyncComplete = useCallback(async () => {
    await fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
  }, [fetchAnalyticsData]);

  const {
    syncStatus,
    syncProgress,
    fetchError,
    setFetchError,
    handleStartSync
  } = useAnalyticsSync(
    walletAddress,
    isPremium,
    handleSyncComplete
  );

  // Fetch data as soon as we know the user is premium, even if sync isn't complete yet
  useEffect(() => {
    if (walletAddress && isPremium && (syncStatus === 'completed' || syncStatus === 'syncing')) {
       fetchAnalyticsData(timeframeRef.current, bottomTimeframeRef.current);
    }
  }, [walletAddress, isPremium, syncStatus === 'completed']); // Only re-trigger on completed transition

  const fetchBottomOnly = async (tf: string, startDate?: string, endDate?: string) => {
    if (!walletAddress) return;
    try {
      let url = `${API_URL}/api/analytics/data?wallet=${walletAddress}&timeframe=${encodeURIComponent(tf)}`;
      if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
      if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setBottomAnalyticsData(data);
    } catch (err) {
      console.error('Fetch bottom analytics error:', err);
    }
  };

  const handleOpenVisualizer = () => {
    if (walletAddress) {
      navigate(`/profile/${walletAddress}/visualizer`);
    }
  };

  const fetchAllTransactionsForExport = async (): Promise<any[]> => {
    if (!walletAddress) return [];
    
    let allTxs: any[] = [];
    let page = 1;
    let hasMore = true;
    const limit = 1000;

    let startDateParam = '';
    if (exportTimeframe !== 'all') {
      const start = new Date();
      if (exportTimeframe === '30d') start.setDate(start.getDate() - 30);
      else if (exportTimeframe === '3m') start.setMonth(start.getMonth() - 3);
      else if (exportTimeframe === '6m') start.setMonth(start.getMonth() - 6);
      else if (exportTimeframe === '12m') start.setFullYear(start.getFullYear() - 1);
      startDateParam = `&startDate=${encodeURIComponent(start.toISOString())}`;
    }

    while (hasMore) {
      const url = `${API_URL}/api/transactions?wallet=${walletAddress}&limit=${limit}&page=${page}${startDateParam}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }
      const json = await response.json();
      const txs = json.transactions || [];
      allTxs = allTxs.concat(txs);
      hasMore = json.hasMore && txs.length === limit;
      page++;
    }
    return allTxs;
  };

  const handleDownloadPDF = async () => {
    setShowDownloadDropdown(false);
    setExportLoading(true);
    try {
      const txs = await fetchAllTransactionsForExport();
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to download the PDF statement.');
        return;
      }
      
      const html = generateStatementHTML(walletAddress || '', txs, analyticsData);
      
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err) {
      console.error('Failed to export PDF:', err);
      alert('Failed to generate PDF statement. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleDownloadCSV = async () => {
    setShowDownloadDropdown(false);
    setExportLoading(true);
    try {
      const txs = await fetchAllTransactionsForExport();
      
      const headers = ['Date', 'Tx Hash', 'Type', 'Description', 'Sent Asset', 'Sent Amount', 'Received Asset', 'Received Amount', 'Value (USD)', 'Status'];
      const rows = txs.map(tx => {
        const date = new Date(tx.tx_timestamp).toISOString();
        const cleanHash = String(tx.tx_hash || '').replace(/^v/i, '');
        const type = tx.tx_type || '';
        const desc = (tx.tx_label || '').replace(/"/g, '""');
        const sentAsset = tx.token_in || '';
        const sentAmount = tx.amount_in != null ? tx.amount_in : '';
        const recAsset = tx.token_out || '';
        const recAmount = tx.amount_out != null ? tx.amount_out : '';
        
        let valUsd = 0;
        if (tx.tx_type === 'received') {
          valUsd = tx.amount_out_usd || 0;
        } else if (tx.tx_type === 'send') {
          valUsd = tx.amount_in_usd || 0;
        } else {
          valUsd = tx.amount_in_usd || tx.amount_out_usd || 0;
        }

        const status = tx.status || '';

        return [
          date,
          cleanHash,
          type,
          `"${desc}"`,
          sentAsset,
          sentAmount,
          recAsset,
          recAmount,
          valUsd,
          status
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `daftar_statement_${walletAddress}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export CSV:', err);
      alert('Failed to generate CSV statement. Please try again.');
    } finally {
      setExportLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="analytics-v5-container" style={{ padding: '40px 20px' }}>
        <AnalyticsSkeleton />
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="analytics-v5-container" style={{ padding: '40px 20px' }}>
        <PlanGate
          feature="Portfolio Analytics"
          description="Unlock portfolio metrics, performance tracking, transaction filters, and full historical analytics."
          requiredTier="pro"
        />
      </div>
    );
  }

  if (!analyticsData || !bottomAnalyticsData) {
    return (
      <div className="analytics-v5-container" style={{ padding: '40px 20px' }}>
        <AnimatePresence>
          {syncStatus === 'error' && (
            <SyncStateOverlay
              status="error"
              progress={syncProgress}
              onStartSync={handleStartSync}
            />
          )}
        </AnimatePresence>
        <AnalyticsSkeleton />
      </div>
    );
  }

  return (
    <div className="analytics-v5-container">
      <motion.div
        key="dashboard-content"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="analytics-page-header">
          <div className="analytics-page-header-left">
            <h2>Portfolio Intelligence</h2>
            <div className="analytics-page-header-sub">
              <p>Live from database</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <button
                type="button"
                className={`analytics-download-btn ${showDownloadDropdown ? 'active-dropdown' : ''}`}
                onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
                disabled={exportLoading}
              >
                {exportLoading ? (
                  <>
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      style={{ display: "inline-block", width: 14, height: 14, marginRight: 6 }}
                    >
                      <Activity size={14} />
                    </motion.span>
                    Generating...
                  </>
                ) : (
                  <>
                    <Download size={14} style={{ marginRight: 6 }} />
                    Download Statement
                    <ChevronDown
                      size={12}
                      style={{
                        marginLeft: 6,
                        opacity: 0.7,
                        transform: showDownloadDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.25s ease'
                      }}
                    />
                  </>
                )}
              </button>
              <AnimatePresence>
                {showDownloadDropdown && (
                  <motion.div
                    className="analytics-download-dropdown"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="download-dropdown-section-title">
                      Select Period
                    </div>
                    <select
                      className="analytics-download-timeframe-select"
                      value={exportTimeframe}
                      onChange={(e) => setExportTimeframe(e.target.value)}
                    >
                      <option value="all">All-Time</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="3m">Last 3 Months</option>
                      <option value="6m">Last 6 Months</option>
                      <option value="12m">Last 12 Months</option>
                    </select>
                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />
                    <button type="button" onClick={handleDownloadPDF}>
                      <FileText size={14} /> PDF Statement
                    </button>
                    <button type="button" onClick={handleDownloadCSV}>
                      <Table size={14} /> CSV Spreadsheet
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button type="button" className="analytics-visualizer-btn" onClick={handleOpenVisualizer}>
              Launch Visualizer
            </button>
            <button
              type="button"
              className="analytics-rescan-btn-small"
              onClick={handleStartSync}
              title="Rescan Network"
              disabled={syncStatus === 'syncing'}
            >
              <RefreshCw
                size={14}
                className={syncStatus === 'syncing' ? 'spinning' : ''}
              />
            </button>
          </div>
        </div>

        {/* Inline sync banner (non-blocking) */}
        <AnimatePresence>
          {(syncStatus === 'syncing' || syncStatus === 'error') && (
            <SyncStateOverlay
              status={syncStatus as any}
              progress={syncProgress}
              onStartSync={handleStartSync}
            />
          )}
        </AnimatePresence>

        {fetchError && (
          <div className="analytics-error-banner" role="alert">
            {fetchError}
          </div>
        )}

        {analyticsData?.truncated && (
          <div className="analytics-truncation-banner" role="status">
            Showing the most recent {analyticsData.loadedTransactionCount?.toLocaleString()} of your
            transactions (limit {analyticsData.maxTransactionLimit?.toLocaleString()}). Totals may be
            understated for very active wallets.
          </div>
        )}

        <AnalyticsOverview
          data={analyticsData}
          bottomData={bottomAnalyticsData}
          timeframe={timeframe}
          setTimeframe={(tf) => {
            setTimeframe(tf);
            void fetchAnalyticsData(tf, bottomTimeframe);
          }}
          bottomTimeframe={bottomTimeframe}
          setBottomTimeframe={(tf, startDate, endDate) => {
            setBottomTimeframe(tf);
            void fetchBottomOnly(tf, startDate, endDate);
          }}
        />
      </motion.div>
    </div>
  );
};

const generateStatementHTML = (wallet: string, txs: any[], data: any) => {
  const totalTxs = txs.length;
  
  let statementPeriod = 'No Transactions';
  if (txs.length > 0) {
    const formatDate = (dateStr: string) => {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };
    const oldestDate = formatDate(txs[txs.length - 1].tx_timestamp);
    const newestDate = formatDate(txs[0].tx_timestamp);
    statementPeriod = `${oldestDate} - ${newestDate}`;
  }

  // Calculate inflow/outflow from the actual transaction set being printed
  const inflow = txs.reduce((sum: number, tx: any) => sum + (tx.tx_type === 'received' ? (tx.amount_out_usd || 0) : 0), 0);
  const outflow = txs.reduce((sum: number, tx: any) => sum + (tx.tx_type === 'send' ? (tx.amount_in_usd || 0) : 0), 0);
  const netFlow = inflow - outflow;
  
  let currentMonthYear = '';
  const rows: string[] = [];

  txs.forEach((tx: any) => {
    const txDate = new Date(tx.tx_timestamp);
    const monthYear = txDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    
    if (monthYear !== currentMonthYear) {
      currentMonthYear = monthYear;
      rows.push(`
        <tr class="month-separator-row">
          <td colspan="6" class="month-separator-cell">${monthYear}</td>
        </tr>
      `);
    }

    const date = txDate.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const cleanHash = String(tx.tx_hash || '').replace(/^v/i, '');
    const hashShort = cleanHash ? (cleanHash.length > 16 ? `${cleanHash.slice(0, 8)}...${cleanHash.slice(-8)}` : cleanHash) : 'N/A';
    
    let details = '';
    if (tx.tx_type === 'swap') {
      details = `Swap ${tx.amount_in?.toFixed(4) || ''} ${tx.token_in || ''} for ${tx.amount_out?.toFixed(4) || ''} ${tx.token_out || ''}`;
    } else if (tx.tx_type === 'send') {
      details = `Send ${tx.amount_in?.toFixed(4) || ''} ${tx.token_in || ''}`;
    } else if (tx.tx_type === 'received') {
      details = `Receive ${tx.amount_out?.toFixed(4) || ''} ${tx.token_out || ''}`;
    } else {
      details = tx.tx_label || 'Contract Interaction';
    }

    let value = '$0.00';
    let valueClass = 'val-neutral';
    if (tx.tx_type === 'received') {
      value = `+$${(tx.amount_out_usd || 0).toFixed(2)}`;
      valueClass = 'val-in';
    } else if (tx.tx_type === 'send') {
      value = `-$${(tx.amount_in_usd || 0).toFixed(2)}`;
      valueClass = 'val-out';
    } else {
      const amount = tx.amount_in_usd || tx.amount_out_usd || 0;
      if (amount > 0) {
        value = `$${amount.toFixed(2)}`;
      }
    }

    rows.push(`
      <tr>
        <td>${date}</td>
        <td><a href="https://explorer.movementnetwork.xyz/txn/${encodeURIComponent(cleanHash)}?network=mainnet" target="_blank" class="hash-link">${hashShort}</a></td>
        <td><span class="badge badge-${tx.tx_type}">${tx.tx_type.toUpperCase()}</span></td>
        <td>${details}</td>
        <td class="${valueClass}">${value}</td>
        <td><span class="status-${tx.status}">${tx.status.toUpperCase()}</span></td>
      </tr>
    `);
  });

  const rowsHtml = rows.join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Daftar Account Statement - ${wallet}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        body {
          font-family: 'Inter', -apple-system, sans-serif;
          color: #1e293b;
          margin: 0;
          padding: 40px;
          line-height: 1.5;
          background-color: #ffffff;
        }

        .statement-card {
          max-width: 1000px;
          margin: 0 auto;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #CDA169;
          padding-bottom: 24px;
          margin-bottom: 30px;
        }

        .logo-area h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -1px;
        }

        .logo-area p {
          margin: 6px 0 0 0;
          color: #64748b;
          font-size: 14px;
          font-weight: 500;
        }

        .meta-area {
          text-align: right;
          font-size: 13px;
          color: #475569;
          line-height: 1.6;
        }

        .meta-area strong {
          color: #0f172a;
        }

        .summary-container {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 35px;
        }

        .summary-card {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 18px;
          background: #f8fafc;
        }

        .summary-card .label {
          font-size: 11px;
          text-transform: uppercase;
          color: #64748b;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }

        .summary-card .value {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
        }

        .summary-card .value.positive {
          color: #10b981;
        }

        .summary-card .value.negative {
          color: #ef4444;
        }

        .table-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 16px 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        th {
          background: #f1f5f9;
          border-bottom: 2px solid #e2e8f0;
          padding: 12px 10px;
          text-align: left;
          font-weight: 700;
          text-transform: uppercase;
          color: #475569;
          letter-spacing: 0.5px;
        }

        td {
          padding: 12px 10px;
          border-bottom: 1px solid #e2e8f0;
          color: #334155;
          vertical-align: middle;
        }

        tr:nth-child(even) td {
          background: #f8fafc;
        }

        tr {
          page-break-inside: avoid;
        }

        .month-separator-row td {
          background-color: #f1f5f9 !important;
          color: #0f172a;
          font-weight: 700;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          padding: 10px 10px;
          border-bottom: 2px solid #CDA169;
          border-top: 1px solid #e2e8f0;
        }

        .hash-link {
          color: #b2854f;
          text-decoration: none;
          font-family: monospace;
          font-weight: 500;
        }

        .hash-link:hover {
          text-decoration: underline;
        }

        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .badge-swap { background: rgba(139,92,246,0.1); color: #8B5CF6; }
        .badge-send { background: rgba(239,68,68,0.1); color: #EF4444; }
        .badge-received { background: rgba(16,185,129,0.1); color: #10B981; }
        .badge-other { background: rgba(148,163,184,0.1); color: #64748B; }

        .val-in { color: #10b981; font-weight: 600; }
        .val-out { color: #ef4444; font-weight: 600; }
        .val-neutral { color: #475569; font-weight: 500; }

        .status-success { color: #10b981; font-weight: 600; }
        .status-failed { color: #ef4444; font-weight: 600; }

        .footer {
          border-top: 1px solid #e2e8f0;
          padding-top: 24px;
          margin-top: 40px;
          font-size: 11px;
          color: #64748b;
          text-align: center;
          line-height: 1.6;
        }

        @media print {
          body {
            padding: 0;
          }
          @page {
            margin: 1.5cm;
          }
          .hash-link {
            color: #0f172a;
          }
        }
      </style>
    </head>
    <body>
      <div class="statement-card">
        <div class="header">
          <div class="logo-area">
            <h1>DAFTAR PORTFOLIO</h1>
            <p>DeFi Account Statement</p>
          </div>
          <div class="meta-area">
            <div><strong>Wallet:</strong> ${wallet}</div>
            <div><strong>Network:</strong> Movement Network</div>
            <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
            <div><strong>Statement Period:</strong> ${statementPeriod}</div>
          </div>
        </div>

        <div class="summary-container">
          <div class="summary-card">
            <div class="label">Total Inflow</div>
            <div class="value positive">+$${inflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div class="summary-card">
            <div class="label">Total Outflow</div>
            <div class="value negative">-$${outflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div class="summary-card">
            <div class="label">Net Flow</div>
            <div class="value ${netFlow >= 0 ? 'positive' : 'negative'}">
              ${netFlow >= 0 ? '+' : ''}$${netFlow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div class="summary-card">
            <div class="label">Transactions</div>
            <div class="value">${totalTxs}</div>
          </div>
        </div>

        <div class="table-title">Transaction History</div>
        <table>
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Tx Hash</th>
              <th>Type</th>
              <th>Detail</th>
              <th>Value (USD)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #64748b;">No transactions found.</td></tr>'}
          </tbody>
        </table>

        <div class="footer">
          This statement was automatically generated by the Daftar Portfolio Tracker on ${new Date().toLocaleDateString()}.<br>
          Historical values are calculated based on token prices at the time of transaction execution. This is a read-only tracking summary and does not constitute official financial advice.<br>
          <strong>Powered by Movement Network</strong>
        </div>
      </div>
      <script>
        setTimeout(function() {
          window.print();
        }, 500);
      </script>
    </body>
    </html>
  `;
};

export default AnalyticsView;
