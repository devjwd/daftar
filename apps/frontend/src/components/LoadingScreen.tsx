import React from 'react';

const LoadingScreen: React.FC = () => {
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary, #0f0d0c)',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 9999,
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2rem'
      }}>
        <div style={{
          position: 'relative',
          width: '100px',
          height: '100px',
          animation: 'breathing 2.5s ease-in-out infinite'
        }}>
          <img 
            src="/daftar icon.png" 
            alt="Daftar" 
            style={{ 
              width: '100%', 
              height: '100%', 
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 20px rgba(205, 161, 105, 0.15))'
            }} 
          />
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--primary, #cda169)',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            opacity: 0.8
          }}>
            Loading
          </span>
          <div style={{
            width: '40px',
            height: '1px',
            background: 'linear-gradient(90deg, transparent, var(--primary, #cda169), transparent)',
            opacity: 0.3
          }} />
        </div>
      </div>

      <style>{`
        @keyframes breathing {
          0% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;

