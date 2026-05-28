import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import VisualizerTab from '../components/Dashboard/VisualizerTab';

export default function StandaloneVisualizer() {
  const { address } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `Network Visualizer - ${address?.slice(0, 6)}... | Daftar`;
  }, [address]);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg-primary)',
      color: '#fff',
      padding: '24px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            }}
            title="Go Back"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 900,
              color: '#f3dfbe',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.5px'
            }}>
              Daftar On-Chain Network Visualizer
            </h1>
            <p style={{
              margin: '4px 0 0 0',
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.4)',
              fontFamily: 'monospace'
            }}>
              Target: {address}
            </p>
          </div>
        </div>
      </div>

      {/* Fullscreen Visualizer Card */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <VisualizerTab viewingAddress={address || null} isFullscreen={true} />
      </div>
    </div>
  );
}
