import React from 'react';
import { motion } from 'framer-motion';

const AnalyticsSkeleton = () => (
  <div className="analytics-v5-container" style={{ width: '100%' }}>
    {/* Page Header Skeleton */}
    <div className="analytics-page-header" style={{ marginBottom: '24px' }}>
      <div style={{ width: '200px', height: '32px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px' }} />
      <div style={{ display: 'flex', gap: '12px' }}>
         <div style={{ width: '140px', height: '38px', background: 'rgba(255,255,255,0.04)', borderRadius: '100px' }} />
         <div style={{ width: '120px', height: '38px', background: 'rgba(255,255,255,0.04)', borderRadius: '100px' }} />
      </div>
    </div>

    {/* Top Grid: Main chart (1.8) and Sidebar (1) */}
    <div className="overview-grid-v5">
      <div className="bento-card" style={{ height: '450px', padding: '28px' }}>
         <div style={{ width: '40%', height: '20px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', marginBottom: '12px' }} />
         <div style={{ width: '20%', height: '40px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', marginBottom: '40px' }} />
         <div style={{ width: '100%', height: '240px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', position: 'relative', overflow: 'hidden' }}>
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
      <div className="stats-column-v5">
         <div className="bento-card" style={{ height: '450px', padding: '24px' }}>
            <div style={{ width: '60%', height: '16px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', marginBottom: '24px' }} />
            <div style={{ width: '100%', height: '60px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '24px' }} />
            <div style={{ width: '100%', height: '200px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }} />
         </div>
      </div>
    </div>

    {/* Bottom sections skeleton */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="bento-card" style={{ width: '100%', height: '380px', padding: '28px' }}>
         <div style={{ width: '20%', height: '20px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', marginBottom: '40px' }} />
         <div style={{ display: 'flex', gap: '32px' }}>
             <div style={{ flex: 1, height: '200px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }} />
             <div style={{ flex: 1, height: '200px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }} />
         </div>
      </div>
      <div className="bottom-sections-grid-v5">
         <div className="bento-card" style={{ width: '100%', height: '300px' }}>
            <div style={{ width: '30%', height: '16px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', marginBottom: '24px' }} />
            <div style={{ width: '100%', height: '40px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '12px' }} />
            <div style={{ width: '100%', height: '40px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '12px' }} />
            <div style={{ width: '100%', height: '40px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }} />
         </div>
      </div>
    </div>
  </div>
);

export default AnalyticsSkeleton;
