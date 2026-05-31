import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { manageReports } from '../services/api';
import { createAdminProofHeaders } from '../services/adminProof';

interface BugReportItem {
  id: string;
  type: string;
  description: string;
  screenshot?: string;
  walletAddress?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  timestamp: string;
}

export default function ReportAdmin() {
  const { account, signMessage } = useWallet();
  const [reports, setReports] = useState<BugReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null); // For image lightbox zoom

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  };

  const createAuth = useCallback(async (body: any) => {
    if (!account || !signMessage) throw new Error('Wallet not ready');
    return await createAdminProofHeaders({
      account,
      signMessage,
      action: 'manage-reports',
      body
    });
  }, [account, signMessage]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const body = { method: 'LIST' as const };
      const auth = await createAuth(body);
      const res = await manageReports(body, auth);
      if (res.ok && res.data?.reports) {
        setReports(res.data.reports);
      } else {
        throw new Error(res.error || 'Failed to fetch reports');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [createAuth]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDeleteReport = async (reportId: string) => {
    if (!window.confirm('Are you sure you want to resolve and delete this report?')) return;
    
    setActionLoading(reportId);
    try {
      const body = { method: 'DELETE' as const, id: reportId };
      const auth = await createAuth(body);
      const res = await manageReports(body, auth);

      if (res.ok) {
        showMessage('success', 'Report resolved and deleted successfully');
        // Refresh local list
        setReports(prev => prev.filter(r => r.id !== reportId));
      } else {
        throw new Error(res.error || 'Failed to delete report');
      }
    } catch (err: any) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString();
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'token': return 'Incorrect Token Data';
      case 'layout': return 'Layout / CSS Issue';
      case 'transaction': return 'Transaction Issue';
      case 'general': return 'General Bug';
      default: return cat.charAt(0).toUpperCase() + cat.slice(1);
    }
  };

  const getCategoryBadgeClass = (cat: string) => {
    switch (cat) {
      case 'token': return 'report-badge-token';
      case 'layout': return 'report-badge-layout';
      case 'transaction': return 'report-badge-transaction';
      case 'general': return 'report-badge-general';
      default: return 'report-badge-other';
    }
  };

  // Filter & Search
  const filteredReports = reports.filter(r => {
    const matchesCategory = categoryFilter === 'all' || r.type === categoryFilter;
    const matchesSearch = 
      r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.walletAddress || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.tokenSymbol || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.tokenAddress || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="admin-content">
      <div className="admin-list-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>User Issue Reports</h2>
            <span className="current-plan-badge" style={{ background: 'rgba(205,161,105,0.1)', color: 'var(--primary)', borderColor: 'rgba(205,161,105,0.2)', borderWidth: '1px', borderStyle: 'solid', padding: '2px 8px', borderRadius: '6px', fontSize: '12px' }}>
              {filteredReports.length} Reports
            </span>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Filter by Category */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="setting-select"
              style={{ background: 'var(--card-bg, #1a1a1a)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px', padding: '6px 12px', height: '38px', fontSize: '13px' }}
            >
              <option value="all">All Categories</option>
              <option value="general">General Bug</option>
              <option value="token">Incorrect Token Data</option>
              <option value="layout">Layout / CSS Issue</option>
              <option value="transaction">Transaction Issue</option>
              <option value="other">Other</option>
            </select>

            <div className="admin-search-wrapper" style={{ width: '320px' }}>
              <div className="admin-search-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <input 
                type="text" 
                placeholder="Search description, wallet, token..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%' }}
              />
            </div>
            <button className="admin-btn admin-btn-secondary" onClick={fetchReports} disabled={loading} style={{ height: '38px', display: 'flex', alignItems: 'center' }}>
              ↻
            </button>
          </div>
        </div>

        {message.text && (
          <div className={`admin-message ${message.type}`} style={{ marginBottom: '20px' }}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="admin-empty-state">Loading reports database...</div>
        ) : filteredReports.length === 0 ? (
          <div className="admin-empty-state">No reports found matching criteria.</div>
        ) : (
          <div className="admin-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredReports.map(report => (
              <div key={report.id} className="admin-list-item" style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', background: 'rgba(25,23,20,0.4)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                      <span className={`report-cat-badge ${getCategoryBadgeClass(report.type)}`}>
                        {getCategoryLabel(report.type)}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary, #888)' }}>
                        {formatDate(report.timestamp)}
                      </span>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                        ID: {report.id}
                      </span>
                    </div>

                    {report.walletAddress && (
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '12px' }}>
                        Reported by: <code style={{ color: 'var(--primary)', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: '4px' }}>{report.walletAddress}</code>
                      </div>
                    )}

                    {report.type === 'token' && (report.tokenSymbol || report.tokenAddress) && (
                      <div style={{ background: 'rgba(205,161,105,0.04)', border: '1px solid rgba(205,161,105,0.15)', borderRadius: '8px', padding: '12px', marginBottom: '16px', maxWidth: '500px' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--primary)', marginBottom: '4px' }}>Token Metadata</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                          <div>Symbol: <strong style={{ color: '#fff' }}>{report.tokenSymbol}</strong></div>
                          <div>Address: <code style={{ color: '#aaa' }}>{report.tokenAddress}</code></div>
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: '14px', color: '#fff', lineHeight: '1.6', whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      {report.description}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '16px', flexShrink: 0 }}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                      onClick={() => handleDeleteReport(report.id)}
                      disabled={actionLoading === report.id}
                    >
                      {actionLoading === report.id ? 'Resolving...' : 'Resolve / Delete'}
                    </button>

                    {report.screenshot && (
                      <div className="report-screenshot-thumb" style={{ cursor: 'pointer', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden', width: '120px', height: '80px', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSelectedImage(report.screenshot || null)}>
                        <img src={report.screenshot} alt="Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.2s' }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox zoom view */}
      {selectedImage && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={() => setSelectedImage(null)}>
          <button style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', color: '#fff', width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold' }}>✕</button>
          <img src={selectedImage} alt="Zoomed screenshot" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 40px rgba(0,0,0,0.8)' }} />
        </div>
      )}

      {/* CSS definitions local for Report categories */}
      <style>{`
        .report-cat-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .report-badge-token {
          background: rgba(245, 158, 11, 0.12);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.2);
        }
        .report-badge-layout {
          background: rgba(59, 130, 246, 0.12);
          color: #3b82f6;
          border: 1px solid rgba(59, 130, 246, 0.2);
        }
        .report-badge-transaction {
          background: rgba(16, 185, 129, 0.12);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .report-badge-general {
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .report-badge-other {
          background: rgba(255, 255, 255, 0.05);
          color: #aaa;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .report-screenshot-thumb:hover img {
          transform: scale(1.08);
        }
      `}</style>
    </div>
  );
}
