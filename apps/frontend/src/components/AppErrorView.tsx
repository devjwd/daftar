import React from 'react';

interface AppErrorViewProps {
  code?: string;
  title: string;
  message: string;
  onRetry?: () => void;
}

const AppErrorView: React.FC<AppErrorViewProps> = ({ code, title, message, onRetry }) => {
  return (
    <div style={{
      padding: '4rem 2rem',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      width: '100%',
      background: 'transparent'
    }}>
      <div style={{
        padding: '3rem',
        borderRadius: 'var(--radius-2xl, 24px)',
        background: 'var(--glass, rgba(205, 161, 105, 0.05))',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border-subtle, rgba(205, 161, 105, 0.1))',
        maxWidth: '500px',
        width: '90%',
        boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.3))'
      }}>
        <div style={{
          fontSize: '4rem',
          marginBottom: '1rem',
          opacity: 0.5,
          filter: 'drop-shadow(0 0 10px rgba(224, 106, 106, 0.3))'
        }}>
          {code === '404' ? '🔍' : '🛡️'}
        </div>

        {code && (
          <div style={{
            fontSize: '0.875rem',
            fontWeight: 700,
            color: 'var(--error, #e06a6a)',
            letterSpacing: '0.2em',
            marginBottom: '0.5rem',
            textTransform: 'uppercase'
          }}>
            Error {code}
          </div>
        )}

        <h2 style={{ 
          fontSize: '1.75rem', 
          fontWeight: 700, 
          marginBottom: '1rem',
          color: 'var(--text-primary, #f7f3ee)'
        }}>
          {title}
        </h2>

        <p style={{ 
          color: 'var(--text-secondary, #d6c6b3)',
          opacity: 0.8,
          lineHeight: 1.6,
          marginBottom: '2.5rem'
        }}>
          {message}
        </p>

        {onRetry && (
          <button 
            onClick={onRetry}
            className="premium-button"
            style={{
              padding: '1rem 2.5rem',
              background: 'var(--gradient-primary, linear-gradient(135deg, #cda169 0%, #a77b43 100%))',
              color: '#14110f',
              border: 'none',
              borderRadius: 'var(--radius-md, 12px)',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.9375rem',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              boxShadow: '0 8px 24px rgba(205, 161, 105, 0.2)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(205, 161, 105, 0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(205, 161, 105, 0.2)';
            }}
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  );
};

export default AppErrorView;
