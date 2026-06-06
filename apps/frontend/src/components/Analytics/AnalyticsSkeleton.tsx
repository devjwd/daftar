import React from 'react';
import { motion } from 'framer-motion';

const AnalyticsSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
    {/* Stats row skeleton */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{
            width: '60%',
            height: '10px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '4px',
            marginBottom: '12px',
          }} />
          <div style={{
            width: '40%',
            height: '24px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '6px',
          }} />
        </div>
      ))}
    </div>
    {/* Chart skeleton */}
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid rgba(255,255,255,0.05)',
      height: '280px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, rgba(205,161,105,0.04) 0%, transparent 100%)',
        borderRadius: '12px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, rgba(205,161,105,0.05) 50%, transparent 100%)',
          }}
        />
      </div>
    </div>
    {/* Bottom sections skeleton */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      {[1, 2].map(i => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid rgba(255,255,255,0.05)',
          height: '200px',
        }}>
          <div style={{
            width: '50%',
            height: '12px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '4px',
            marginBottom: '16px',
          }} />
          {[1, 2, 3].map(j => (
            <div key={j} style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '12px',
              width: '100%'
            }}>
              <div style={{ width: '30%', height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
              <div style={{ width: '20%', height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

export default AnalyticsSkeleton;
