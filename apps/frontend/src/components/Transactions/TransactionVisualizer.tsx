import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Cpu, User, ArrowRightLeft, ZoomIn, ZoomOut, RotateCcw, HelpCircle } from 'lucide-react';
import styles from './TransactionVisualizer.module.css';
import { DEFI_PROTOCOL_VISUALS, getLogoForLabel } from '../../config/display';
import { findEntityByAddress } from '../../services/entityStore';

interface TransactionVisualizerProps {
  tx: any;
  onClose: () => void;
  language?: string;
}

export default function TransactionVisualizer({ tx, onClose, language = 'en' }: TransactionVisualizerProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<'left' | 'right' | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const cleanHash = useMemo(() => {
    return String(tx?.tx_hash || '').replace(/^v/i, '');
  }, [tx]);

  // Transaction details
  const txType = String(tx?.tx_type || 'other').toLowerCase();
  const dappName = String(tx?.dapp_name || 'Wallet');

  // Decide flow details
  const isSimpleTransfer = ['send', 'received', 'transfer'].includes(txType) &&
    (!tx?.dapp_name || String(tx.dapp_name).toLowerCase() === 'wallet');
  const isReceived = txType === 'received';
  const isSend = txType === 'send';

  // Resolve entity information for wallet and counterparty
  const walletEntity = useMemo(() => {
    if (!tx?.wallet_address) return null;
    return findEntityByAddress(tx.wallet_address);
  }, [tx?.wallet_address]);

  const centerNodeBranding = useMemo(() => {
    if (walletEntity) {
      return {
        label: walletEntity.name,
        logo: walletEntity.logo_url || getLogoForLabel(walletEntity.name) || null,
        isEntity: true,
        badgeColor: walletEntity.badge_color || '#8B5CF6'
      };
    }
    return {
      label: 'My Wallet',
      logo: getLogoForLabel('My Wallet') || null,
      isEntity: false,
      badgeColor: '#8B5CF6'
    };
  }, [walletEntity]);

  // Resolve protocol logo
  const protocolLogo = useMemo(() => {
    if (tx?.dapp_logo) return tx.dapp_logo;
    if (!tx?.dapp_name) return null;
    const key = String(tx.dapp_name).toLowerCase().replace(/\s/g, '');
    return (DEFI_PROTOCOL_VISUALS as any)[key]?.logo || getLogoForLabel(tx.dapp_name) || null;
  }, [tx?.dapp_logo, tx?.dapp_name]);

  // Inflow details: User received tokens
  // If it's a received transfer, user gets the sent amount.
  const hasInflow = isReceived || (tx.amount_out != null && Number(tx.amount_out) > 0);
  const inflowAmount = isReceived ? (tx.amount_out || tx.amount_in || 0) : (tx.amount_out || 0);
  const inflowSymbol = isReceived ? (tx.token_out || tx.token_in || 'MOVE') : (tx.token_out || 'MOVE');

  // Outflow details: User spent tokens
  // If it's a sent transfer, user sends the amount.
  const hasOutflow = isSend || (tx.amount_in != null && Number(tx.amount_in) > 0);
  const outflowAmount = isSend ? (tx.amount_in || tx.amount_out || 0) : (tx.amount_in || 0);
  const outflowSymbol = isSend ? (tx.token_in || tx.token_out || 'MOVE') : (tx.token_in || 'MOVE');

  // Format short address
  const formatAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Node 1: Left Node details
  const leftNodeDetails = useMemo(() => {
    if (isSimpleTransfer) {
      if (isReceived) {
        // Left is Sender
        const entity = tx.counterparty_address ? findEntityByAddress(tx.counterparty_address) : null;
        return {
          label: entity ? entity.name : 'Sender',
          subLabel: tx.counterparty_address ? formatAddress(tx.counterparty_address) : 'Source Wallet',
          isWallet: true,
          logo: entity ? (entity.logo_url || getLogoForLabel(entity.name)) : null,
          color: '#16c784',
          shadow: '0 0 15px rgba(22, 199, 132, 0.08)'
        };
      } else {
        // Left is My Wallet
        return {
          label: centerNodeBranding.label,
          subLabel: formatAddress(tx.wallet_address || '0xUserAddress'),
          isWallet: true,
          logo: centerNodeBranding.logo,
          color: centerNodeBranding.badgeColor,
          shadow: centerNodeBranding.isEntity
            ? '0 0 20px rgba(229, 190, 138, 0.15)'
            : '0 0 20px rgba(139, 92, 246, 0.1)'
        };
      }
    } else {
      // DeFi transaction: Left is always My Wallet
      return {
        label: centerNodeBranding.label,
        subLabel: formatAddress(tx.wallet_address || '0xUserAddress'),
        isWallet: true,
        logo: centerNodeBranding.logo,
        color: centerNodeBranding.badgeColor,
        shadow: centerNodeBranding.isEntity
          ? '0 0 20px rgba(229, 190, 138, 0.15)'
          : '0 0 20px rgba(139, 92, 246, 0.1)'
      };
    }
  }, [isSimpleTransfer, isReceived, tx, centerNodeBranding]);

  // Node 2: Right Node details
  const rightNodeDetails = useMemo(() => {
    if (isSimpleTransfer) {
      if (isReceived) {
        // Right is My Wallet
        return {
          label: centerNodeBranding.label,
          subLabel: formatAddress(tx.wallet_address || '0xUserAddress'),
          isWallet: true,
          logo: centerNodeBranding.logo,
          color: centerNodeBranding.badgeColor,
          shadow: centerNodeBranding.isEntity
            ? '0 0 20px rgba(229, 190, 138, 0.15)'
            : '0 0 20px rgba(139, 92, 246, 0.1)'
        };
      } else {
        // Right is Recipient
        const entity = tx.counterparty_address ? findEntityByAddress(tx.counterparty_address) : null;
        return {
          label: entity ? entity.name : 'Recipient',
          subLabel: tx.counterparty_address ? formatAddress(tx.counterparty_address) : 'Destination Wallet',
          isWallet: true,
          logo: entity ? (entity.logo_url || getLogoForLabel(entity.name)) : null,
          color: '#ff6b6b',
          shadow: '0 0 15px rgba(255, 107, 107, 0.08)'
        };
      }
    } else {
      // DeFi transaction: Right is always the DeFi Protocol/dApp
      return {
        label: dappName,
        subLabel: tx.counterparty_address
          ? formatAddress(tx.counterparty_address)
          : (tx.dapp_contract ? formatAddress(tx.dapp_contract) : 'DeFi Protocol'),
        isWallet: false,
        logo: protocolLogo,
        color: '#cda169',
        shadow: '0 0 15px rgba(205, 161, 105, 0.1)'
      };
    }
  }, [isSimpleTransfer, isReceived, tx, centerNodeBranding, dappName, protocolLogo]);
  // Spacing for 2 nodes centered in the canvas
  const coords = useMemo(() => {
    return {
      left: 260,
      right: 540,
      y: 160
    };
  }, []);

  const [nodePositions, setNodePositions] = useState({
    left: { x: coords.left, y: coords.y },
    right: { x: coords.right, y: coords.y }
  });

  const inflowCtrl = useMemo(() => {
    const offset = hasOutflow ? -35 : -15;
    return {
      x: (nodePositions.left.x + nodePositions.right.x) / 2,
      y: (nodePositions.left.y + nodePositions.right.y) / 2 + offset
    };
  }, [nodePositions, hasOutflow]);

  const outflowCtrl = useMemo(() => {
    const offset = hasInflow ? 35 : 15;
    return {
      x: (nodePositions.left.x + nodePositions.right.x) / 2,
      y: (nodePositions.left.y + nodePositions.right.y) / 2 + offset
    };
  }, [nodePositions, hasInflow]);

  useEffect(() => {
    setNodePositions({
      left: { x: coords.left, y: coords.y },
      right: { x: coords.right, y: coords.y }
    });
  }, [coords]);

  // Panning canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target instanceof SVGElement && e.target.closest(`.${styles.node}`)) {
      return; // Skip canvas drag if clicking a node
    }
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      });
    }
  };

  const handleCanvasMouseUpOrLeave = () => {
    setIsPanning(false);
  };

  // Node Dragging
  const handleNodeMouseDown = (nodeKey: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    draggedNodeRef.current = nodeKey;
  };

  const handleNodeMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggedNodeRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left - pan.x) / zoom;
    const relativeY = (e.clientY - rect.top - pan.y) / zoom;

    setNodePositions(prev => ({
      ...prev,
      [draggedNodeRef.current!]: {
        x: Math.max(40, Math.min(760, relativeX)),
        y: Math.max(40, Math.min(280, relativeY))
      }
    }));
  };

  const handleNodeMouseUp = () => {
    draggedNodeRef.current = null;
  };

  // Zooming
  const adjustZoom = React.useCallback((zoomFactor: number, focusX?: number, focusY?: number) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const mx = focusX !== undefined ? focusX : rect.width / 2;
    const my = focusY !== undefined ? focusY : rect.height / 2;

    const zoomMin = 0.4;
    const zoomMax = 3.0;

    setZoom(z => {
      const nextZoom = Math.min(zoomMax, Math.max(zoomMin, z + zoomFactor));
      const ratio = nextZoom / z;
      setPan(p => ({
        x: mx - (mx - p.x) * ratio,
        y: my - (my - p.y) * ratio
      }));
      return nextZoom;
    });
  }, []);

  const handleZoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNodePositions({
      left: { x: coords.left, y: coords.y },
      right: { x: coords.right, y: coords.y }
    });
  };

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scaleFactor = 0.08;
      const zoomFactor = -e.deltaY * scaleFactor * 0.01;
      adjustZoom(zoomFactor, mx, my);
    };

    svgEl.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      svgEl.removeEventListener('wheel', handleNativeWheel);
    };
  }, [adjustZoom]);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        {/* Arkham Visualizer Canvas */}
        <div className={styles.visualizerArea}>
          {/* Header Info Overlay */}
          <div className={styles.headerInfoInline}>
            <h2 className={styles.titleInline}>Transaction Flow Visualizer</h2>
            <div className={styles.hashTextInline}>Hash: {cleanHash}</div>
          </div>

          <div className={styles.watermarkBackdrop}>
            <img src="/daftar.svg" alt="Daftar Watermark" className={styles.watermarkLogo} />
          </div>

          {/* SVG Visualizer Canvas */}
          <svg
            ref={svgRef}
            className={styles.svgCanvas}
            viewBox="0 0 800 320"
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={(e) => {
              handleCanvasMouseMove(e);
              handleNodeMouseMove(e);
            }}
            onMouseUp={() => {
              handleCanvasMouseUpOrLeave();
              handleNodeMouseUp();
            }}
            onMouseLeave={() => {
              handleCanvasMouseUpOrLeave();
              handleNodeMouseUp();
            }}
          >
            {/* Transformed Group (Pan & Zoom) */}
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* 1. Curved flow lines (Clean thin wires) */}
              {hasInflow && (
                <path
                  d={`M ${nodePositions.right.x} ${nodePositions.right.y} Q ${inflowCtrl.x} ${inflowCtrl.y} ${nodePositions.left.x} ${nodePositions.left.y}`}
                  stroke="#16c784"
                  strokeWidth={0.65}
                  fill="none"
                  opacity={0.45}
                />
              )}

              {hasOutflow && (
                <path
                  d={`M ${nodePositions.left.x} ${nodePositions.left.y} Q ${outflowCtrl.x} ${outflowCtrl.y} ${nodePositions.right.x} ${nodePositions.right.y}`}
                  stroke="#ff6b6b"
                  strokeWidth={0.65}
                  fill="none"
                  opacity={0.45}
                />
              )}

              {/* 2. Value Badges */}
              {hasInflow && (
                <foreignObject
                  x={inflowCtrl.x - 100}
                  y={inflowCtrl.y - 15}
                  width={200}
                  height={30}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                    <div className={`${styles.ribbonBadge} ${styles.inflowBadge}`}>
                      + {inflowAmount.toFixed(4).replace(/\.?0+$/, "")} {inflowSymbol}
                    </div>
                  </div>
                </foreignObject>
              )}

              {hasOutflow && (
                <foreignObject
                  x={outflowCtrl.x - 100}
                  y={outflowCtrl.y - 15}
                  width={200}
                  height={30}
                >
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                    <div className={`${styles.ribbonBadge} ${styles.outflowBadge}`}>
                      - {outflowAmount.toFixed(4).replace(/\.?0+$/, "")} {outflowSymbol}
                    </div>
                  </div>
                </foreignObject>
              )}

              {/* 3. Interactive Nodes */}
              {/* Left Node */}
              <foreignObject
                x={nodePositions.left.x - 100}
                y={nodePositions.left.y - 26}
                width={200}
                height={130}
              >
                <div
                  className={styles.node}
                  onMouseDown={(e) => handleNodeMouseDown('left', e)}
                >
                  <div
                    className={styles.nodeContent}
                    style={{
                      borderColor: leftNodeDetails.color,
                      boxShadow: leftNodeDetails.shadow
                    }}
                  >
                    {leftNodeDetails.logo ? (
                      <img src={leftNodeDetails.logo} alt={leftNodeDetails.label} className={styles.nodeLogo} />
                    ) : leftNodeDetails.label === 'My Wallet' ? (
                      <Wallet size={24} color="#a78bfa" />
                    ) : leftNodeDetails.isWallet ? (
                      <User size={24} color={leftNodeDetails.color} />
                    ) : (
                      <Cpu size={24} color={leftNodeDetails.color} />
                    )}
                  </div>
                  <div className={styles.nodeLabel}>{leftNodeDetails.label}</div>
                  <div className={styles.nodeSubLabel}>{leftNodeDetails.subLabel}</div>
                </div>
              </foreignObject>

              {/* Right Node */}
              <foreignObject
                x={nodePositions.right.x - 100}
                y={nodePositions.right.y - 26}
                width={200}
                height={130}
              >
                <div
                  className={styles.node}
                  onMouseDown={(e) => handleNodeMouseDown('right', e)}
                >
                  <div
                    className={styles.nodeContent}
                    style={{
                      borderColor: rightNodeDetails.color,
                      boxShadow: rightNodeDetails.shadow
                    }}
                  >
                    {rightNodeDetails.logo ? (
                      <img src={rightNodeDetails.logo} alt={rightNodeDetails.label} className={styles.nodeLogo} />
                    ) : rightNodeDetails.label === 'My Wallet' ? (
                      <Wallet size={24} color="#a78bfa" />
                    ) : rightNodeDetails.isWallet ? (
                      <User size={24} color={rightNodeDetails.color} />
                    ) : (
                      <Cpu size={24} color={rightNodeDetails.color} />
                    )}
                  </div>
                  <div className={styles.nodeLabel}>{rightNodeDetails.label}</div>
                  <div className={styles.nodeSubLabel}>{rightNodeDetails.subLabel}</div>
                </div>
              </foreignObject>
            </g>
          </svg>

          {/* Controls & Close */}
          <div className={styles.controls}>
            <button className={styles.btn} onClick={() => adjustZoom(0.2)} title="Zoom In"><ZoomIn size={12} /></button>
            <button className={styles.btn} onClick={() => adjustZoom(-0.2)} title="Zoom Out"><ZoomOut size={12} /></button>
            <button className={styles.btn} onClick={handleZoomReset} title="Reset View"><RotateCcw size={12} /></button>
            <div className={styles.divider} />
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={14} /></button>
          </div>

          {/* Details & Instructions Footer (Inline Overlay) */}
          <div className={styles.detailsFooterInline}>
            <div className={styles.detailsRow}>
              <div className={styles.detailItemInline}>
                <span className={styles.detailLabel}>Type</span>
                <span className={styles.detailValue} style={{ color: tx.tx_color || '#fff' }}>{txType.toUpperCase()}</span>
              </div>
              <div className={styles.detailItemInline}>
                <span className={styles.detailLabel}>Protocol</span>
                <span className={styles.detailValue}>{dappName}</span>
              </div>
              {tx.gas_fee != null && (
                <div className={styles.detailItemInline}>
                  <span className={styles.detailLabel}>Gas Fee</span>
                  <span className={styles.detailValue}>{Number(tx.gas_fee).toFixed(5)} MOVE</span>
                </div>
              )}
              <div className={styles.detailItemInline}>
                <span className={styles.detailLabel}>Status</span>
                <span className={styles.detailValue} style={{ color: tx.status === 'failed' ? '#ff6b6b' : '#16c784' }}>
                  {tx.status?.toUpperCase() || 'SUCCESS'}
                </span>
              </div>
            </div>

            <div className={styles.instructionsInline}>
              <HelpCircle size={10} />
              <span>Scroll to zoom · Drag background to pan · Drag nodes to organize</span>
            </div>
          </div>

        </div>

      </div>
    </div>,
    document.body
  );
}
