import React from 'react';

const LoadingScreen: React.FC = () => {
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary, #14110f)',
      color: 'var(--text-primary, #f7f3ee)',
      flexDirection: 'column',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 9999,
      overflow: 'hidden'
    }}>
      {/* Background Mesh Gradient */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        right: '-10%',
        width: '60%',
        height: '60%',
        background: 'radial-gradient(circle, rgba(205, 161, 105, 0.08) 0%, transparent 70%)',
        filter: 'blur(80px)',
        zIndex: -1
      }}></div>
      <div style={{
        position: 'absolute',
        bottom: '-10%',
        left: '-10%',
        width: '50%',
        height: '50%',
        background: 'radial-gradient(circle, rgba(167, 123, 67, 0.06) 0%, transparent 70%)',
        filter: 'blur(100px)',
        zIndex: -1
      }}></div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '3rem',
        borderRadius: 'var(--radius-2xl, 24px)',
        background: 'var(--glass, rgba(205, 161, 105, 0.05))',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border-subtle, rgba(205, 161, 105, 0.1))',
        boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.5))'
      }}>
        <div style={{
          position: 'relative',
          width: '80px',
          height: '80px',
          marginBottom: '2rem'
        }}>
          {/* Inner Pulse */}
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            right: '10px',
            bottom: '10px',
            borderRadius: '50%',
            background: 'var(--gradient-primary, linear-gradient(135deg, #cda169 0%, #a77b43 100%))',
            opacity: 0.15,
            animation: 'pulse 2s ease-in-out infinite'
          }}></div>
          
          {/* Main Spinner Ring */}
          <div style={{
            width: '100%',
            height: '100%',
            border: '3px solid rgba(205, 161, 105, 0.1)',
            borderTop: '3px solid var(--primary, #cda169)',
            borderRadius: '50%',
            animation: 'spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite',
            boxShadow: '0 0 15px rgba(205, 161, 105, 0.2)'
          }}></div>
        </div>

        <h2 style={{ 
          fontSize: '1.25rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          marginBottom: '0.5rem',
          background: 'var(--gradient-accent, linear-gradient(135deg, #deb884 0%, #cda169 100%))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textTransform: 'uppercase'
        }}>
          DAFTAR
        </h2>
        <p style={{ 
          fontSize: '0.875rem',
          color: 'var(--text-secondary, #d6c6b3)',
          opacity: 0.6,
          fontWeight: 400
        }}>
          Connecting to Movement...
        </p>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { transform: scale(0.9); opacity: 0.1; }
          50% { transform: scale(1.1); opacity: 0.3; }
          100% { transform: scale(0.9); opacity: 0.1; }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;
