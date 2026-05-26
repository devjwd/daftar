import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Wallet,
  Cpu,
  User,
  Coins,
  Loader2,
  HelpCircle,
  AlertCircle
} from 'lucide-react';
import { getOrFetchTransactions } from '../../services/transactionService';
import { getProfile } from '../../services/api';
import styles from './VisualizerTab.module.css';

interface Node {
  id: string;
  label: string;
  type: 'wallet' | 'protocol' | 'central';
  logo?: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
  radius: number;
  txCount: number;
  inflowUsd: number;
  outflowUsd: number;
  tokens: Set<string>;
}

interface Link {
  id: string;
  source: string;
  target: string;
  txCount: number;
  inflowUsd: number;
  outflowUsd: number;
  tokens: Set<string>;
  direction: 'in' | 'out' | 'both';
  // Per-transaction detail for tooltip
  amounts: { amount: number; token: string; direction: 'in' | 'out' }[];
  offset: number;
  txHash?: string;
  txType?: string;
  timestamp?: string;
}

const truncateHash = (hash?: string) => {
  if (!hash) return '—';
  const clean = hash.replace(/^v/i, '');
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
};

const formatDateTime = (value: any) => {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    const datePart = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const timePart = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${datePart} · ${timePart}`;
  } catch {
    return '—';
  }
};

interface VisualizerTabProps {
  viewingAddress: string | null;
  language?: string;
  isFullscreen?: boolean;
}

export default function VisualizerTab({ viewingAddress, language = 'en', isFullscreen = false }: VisualizerTabProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [hoveredLink, setHoveredLink] = useState<Link | null>(null);
  const [linkTooltipPos, setLinkTooltipPos] = useState({ x: 0, y: 0 });
  const [txCount, setTxCount] = useState(0);

  // Pan and Zoom State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.35);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Physics Engine Refs & Config
  const requestRef = useRef<number | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const linksRef = useRef<Link[]>([]);
  const nodeMapRef = useRef<Map<string, Node>>(new Map());
  const draggedNodeIdRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const runPhysicsTickRef = useRef<(() => void) | null>(null);

  const wakePhysics = () => {
    if (!requestRef.current && runPhysicsTickRef.current && nodesRef.current.length > 0) {
      requestRef.current = requestAnimationFrame(runPhysicsTickRef.current);
    }
  };

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 500;

  // Load Transactions & Build Graph
  useEffect(() => {
    if (!viewingAddress) {
      setNodes([]);
      setLinks([]);
      return;
    }

    let isMounted = true;
    const fetchGraphData = async () => {
      setLoading(true);
      try {
        let isVerified = false;
        try {
          const profile = await getProfile(viewingAddress);
          if (profile && profile.is_verified) {
            isVerified = true;
          }
        } catch (e) {
          console.warn("Failed to fetch profile verification status:", e);
        }

        let txs: any[] = [];
        if (isVerified) {
          try {
            const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
            const res = await fetch(`${apiBase}/api/transactions?wallet=${encodeURIComponent(viewingAddress)}&limit=10000&type=all`);
            if (res.ok) {
              const data = await res.json();
              txs = data.transactions || [];
            }
          } catch (err) {
            console.warn("Failed to fetch verified transactions from db, falling back to indexer:", err);
          }
        }

        if (!txs || txs.length === 0) {
          txs = await getOrFetchTransactions(viewingAddress, { limit: 1000 });
        }
        if (!isMounted) return;

        setTxCount(txs.length);

        const centerId = viewingAddress.toLowerCase();

        // Temporary maps to aggregate nodes and links
        const nodeMap = new Map<string, {
          label: string;
          type: 'wallet' | 'protocol';
          logo?: string | null;
          txCount: number;
          inflowUsd: number;
          outflowUsd: number;
          tokens: Set<string>;
        }>();

        txs.forEach((tx: any) => {
          // Identify counterparty / protocol
          let counterpartyId = '';
          let label = '';
          let type: 'wallet' | 'protocol' = 'wallet';
          let logo = null;

          if (tx.dapp_key && tx.dapp_name && tx.dapp_name !== 'Wallet') {
            counterpartyId = tx.dapp_name.toLowerCase();
            label = tx.dapp_name;
            type = 'protocol';
            logo = tx.dapp_logo;
          } else if (tx.counterparty_address) {
            counterpartyId = tx.counterparty_address.toLowerCase();
            label = `${tx.counterparty_address.slice(0, 6)}...${tx.counterparty_address.slice(-4)}`;
            type = 'wallet';
          } else if (tx.dapp_contract) {
            // Fallback: use dapp_contract as counterparty
            counterpartyId = tx.dapp_contract.toLowerCase();
            label = tx.dapp_name || `${tx.dapp_contract.slice(0, 6)}...${tx.dapp_contract.slice(-4)}`;
            type = 'protocol';
            logo = tx.dapp_logo;
          } else if (tx.sender && tx.sender.toLowerCase() !== centerId) {
            // Fallback: use sender as counterparty
            counterpartyId = tx.sender.toLowerCase();
            label = `${tx.sender.slice(0, 6)}...${tx.sender.slice(-4)}`;
            type = 'wallet';
          } else {
            return; // Truly no counterparty
          }

          if (counterpartyId === centerId) return; // Skip loops to self

          const isTxInflow = tx.tx_type === 'received' || (tx.amount_out_usd && !tx.amount_in_usd);
          const usdValue = Math.max(Number(tx.amount_in_usd || 0), Number(tx.amount_out_usd || 0), Number(tx.pnl_usd || 0));

          // 1. Update counterparty node details
          if (!nodeMap.has(counterpartyId)) {
            nodeMap.set(counterpartyId, {
              label,
              type,
              logo,
              txCount: 0,
              inflowUsd: 0,
              outflowUsd: 0,
              tokens: new Set()
            });
          }

          const nodeData = nodeMap.get(counterpartyId)!;
          nodeData.txCount++;
          if (isTxInflow) {
            nodeData.inflowUsd += usdValue;
            if (tx.token_out) nodeData.tokens.add(tx.token_out);
          } else {
            nodeData.outflowUsd += usdValue;
            if (tx.token_in) nodeData.tokens.add(tx.token_in);
          }
        });

        // Construct Central Node (Initially pinned at center)
        const centralNode: Node = {
          id: centerId,
          label: 'My Wallet',
          type: 'central',
          x: CANVAS_WIDTH / 2,
          y: CANVAS_HEIGHT / 2,
          fx: CANVAS_WIDTH / 2,
          fy: CANVAS_HEIGHT / 2,
          vx: 0,
          vy: 0,
          radius: 16,
          txCount: txs.length,
          inflowUsd: Array.from(nodeMap.values()).reduce((sum, n) => sum + n.inflowUsd, 0),
          outflowUsd: Array.from(nodeMap.values()).reduce((sum, n) => sum + n.outflowUsd, 0),
          tokens: new Set(txs.map((tx: any) => tx.token_in || tx.token_out).filter(Boolean))
        };

        // Construct Outer Nodes
        const outerNodes: Node[] = Array.from(nodeMap.entries()).map(([id, data], index) => {
          const angle = (index / nodeMap.size) * Math.PI * 2;
          const radius = Math.min(280, 130 + data.txCount * 4.5);
          return {
            id,
            label: data.label,
            type: data.type === 'protocol' ? 'protocol' : 'wallet',
            logo: data.logo,
            x: CANVAS_WIDTH / 2 + Math.cos(angle) * radius,
            y: CANVAS_HEIGHT / 2 + Math.sin(angle) * radius,
            vx: 0,
            vy: 0,
            radius: Math.min(13, Math.max(8, 8 + data.txCount * 0.5)),
            txCount: data.txCount,
            inflowUsd: data.inflowUsd,
            outflowUsd: data.outflowUsd,
            tokens: data.tokens
          };
        });

        const allNodes = [centralNode, ...outerNodes];

        // Construct per-transaction links (representing swaps as a single link with both tokens)
        const allLinks: Link[] = [];
        const pairCounts = new Map<string, number>();

        txs.forEach((tx: any, index: number) => {
          let counterpartyId = '';
          if (tx.dapp_key && tx.dapp_name && tx.dapp_name !== 'Wallet') {
            counterpartyId = tx.dapp_name.toLowerCase();
          } else if (tx.counterparty_address) {
            counterpartyId = tx.counterparty_address.toLowerCase();
          } else if (tx.dapp_contract) {
            counterpartyId = tx.dapp_contract.toLowerCase();
          } else if (tx.sender && tx.sender.toLowerCase() !== centerId) {
            counterpartyId = tx.sender.toLowerCase();
          } else {
            return;
          }

          if (counterpartyId === centerId) return;

          const hasInflow = tx.tx_type === 'received' || (tx.amount_out != null && Number(tx.amount_out) > 0);
          const hasOutflow = tx.tx_type === 'send' || (tx.amount_in != null && Number(tx.amount_in) > 0);
          const usdValue = Math.max(Number(tx.amount_in_usd || 0), Number(tx.amount_out_usd || 0), Number(tx.pnl_usd || 0));

          const amounts: { amount: number; token: string; direction: 'in' | 'out' }[] = [];
          if (hasInflow) {
            const amount = Number(tx.amount_out || tx.amount_in || 0);
            const token = tx.token_out || tx.token_in || 'MOVE';
            if (amount > 0) {
              amounts.push({ amount, token, direction: 'in' });
            }
          }
          if (hasOutflow) {
            const amount = Number(tx.amount_in || tx.amount_out || 0);
            const token = tx.token_in || tx.token_out || 'MOVE';
            if (amount > 0) {
              amounts.push({ amount, token, direction: 'out' });
            }
          }

          if (amounts.length === 0) return; // Skip zero-value links

          const pairKey = [counterpartyId, centerId].sort().join('-');
          pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);

          allLinks.push({
            id: `link-${tx.tx_hash || index}-${index}`,
            source: counterpartyId,
            target: centerId,
            txCount: 1,
            inflowUsd: hasInflow ? usdValue : 0,
            outflowUsd: hasOutflow ? usdValue : 0,
            tokens: new Set(amounts.map(a => a.token)),
            direction: hasInflow && hasOutflow ? 'both' : hasInflow ? 'in' : 'out',
            amounts,
            offset: 0,
            txHash: tx.tx_hash,
            txType: tx.tx_type,
            timestamp: tx.tx_timestamp
          });
        });

        // Pre-calculate offsets to spread lines between the same pairs
        const pairIndices = new Map<string, number>();
        allLinks.forEach(link => {
          const pairKey = [link.source, link.target].sort().join('-');
          const total = pairCounts.get(pairKey) || 1;
          const index = pairIndices.get(pairKey) || 0;
          pairIndices.set(pairKey, index + 1);

          if (total === 1) {
            link.offset = 15; // default single curve
          } else {
            const spread = Math.min(120, total * 8.0);
            const start = -spread / 2;
            const step = total > 1 ? spread / (total - 1) : 0;
            link.offset = start + index * step;
          }
        });

        setNodes(allNodes);
        setLinks(allLinks);
        nodesRef.current = allNodes;
        linksRef.current = allLinks;

        // Build node lookup map for O(1) physics access
        const nMap = new Map<string, Node>();
        allNodes.forEach(n => nMap.set(n.id, n));
        nodeMapRef.current = nMap;

        // Reset translation
        setZoom(1.35);

        // Wake physics simulator
        setTimeout(() => wakePhysics(), 50);

      } catch (err) {
        console.error('Failed to construct visualizer graph:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGraphData();

    return () => {
      isMounted = false;
    };
  }, [viewingAddress]);

  // Auto-center visualizer when SVG element finishes mounting/rendering
  useEffect(() => {
    if (nodes.length > 0 && !loading) {
      const svgEl = svgRef.current;
      if (svgEl) {
        const rect = svgEl.getBoundingClientRect();
        setPan({
          x: rect.width / 2 - (CANVAS_WIDTH / 2) * 1.35,
          y: rect.height / 2 - (CANVAS_HEIGHT / 2) * 1.35
        });
      }
    }
  }, [loading, nodes.length]);

  // Force-Directed Physics Simulator
  useEffect(() => {
    if (nodes.length === 0) return;

    // Physics constants (Optimized for orbit constellation settle)
    const kRepel = 240;
    const kAttract = 0.035;
    const linkLength = 120;
    const damping = 0.72; // quick settle damping

    const runPhysicsTick = () => {
      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;
      const nMap = nodeMapRef.current;

      if (currentNodes.length === 0) return;

      // 1. Repulsion between all nodes (Coulomb's Law with Cap)
      for (let i = 0; i < currentNodes.length; i++) {
        const n1 = currentNodes[i];
        if (n1.id === draggedNodeIdRef.current) continue;

        // Pinned node check
        if (n1.fx !== undefined && n1.fy !== undefined) {
          n1.x = n1.fx;
          n1.y = n1.fy;
          n1.vx = 0;
          n1.vy = 0;
          continue;
        }

        for (let j = 0; j < currentNodes.length; j++) {
          if (i === j) continue;
          const n2 = currentNodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const actualDx = dx === 0 ? (Math.random() - 0.5) * 2 : dx;
          const actualDy = dy === 0 ? (Math.random() - 0.5) * 2 : dy;
          const distSq = actualDx * actualDx + actualDy * actualDy || 1;
          const dist = Math.sqrt(distSq);

          if (dist < 300) {
            const force = Math.min(12, kRepel / (distSq + 80));
            n1.vx += (actualDx / dist) * force;
            n1.vy += (actualDy / dist) * force;
          }
        }
      }

      // 2. Link attraction (Hooke's Law) — O(1) node lookups via Map
      for (let i = 0; i < currentLinks.length; i++) {
        const link = currentLinks[i];
        const sourceNode = nMap.get(link.source);
        const targetNode = nMap.get(link.target);
        if (!sourceNode || !targetNode) continue;

        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        // Dynamic link length based on transaction count
        const outerNode = sourceNode.type === 'central' ? targetNode : sourceNode;
        const txCount = outerNode.txCount || 1;
        const targetLength = Math.min(280, 110 + txCount * 4.5);

        // Normalize the attraction force so multiple wires don't multiply gravity pull
        const force = ((dist - targetLength) * kAttract) / txCount;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (sourceNode.id !== draggedNodeIdRef.current && sourceNode.type !== 'central') {
          sourceNode.vx += fx;
          sourceNode.vy += fy;
        }
        if (targetNode.id !== draggedNodeIdRef.current && targetNode.type !== 'central') {
          targetNode.vx -= fx;
          targetNode.vy -= fy;
        }
      }

      // 3. Update positions and velocities (in-place mutation)
      const maxV = 8;
      for (let i = 0; i < currentNodes.length; i++) {
        const node = currentNodes[i];
        if (node.fx !== undefined && node.fy !== undefined) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.x = Math.max(node.radius, Math.min(CANVAS_WIDTH - node.radius, node.x + node.vx));
        node.y = Math.max(node.radius, Math.min(CANVAS_HEIGHT - node.radius, node.y + node.vy));
        node.vx = Math.max(-maxV, Math.min(maxV, node.vx * damping));
        node.vy = Math.max(-maxV, Math.min(maxV, node.vy * damping));
      }

      // UPDATE SVG DOM DIRECTLY (bypasses React render overhead)
      const svgEl = svgRef.current;
      if (svgEl) {
        for (let i = 0; i < currentNodes.length; i++) {
          const node = currentNodes[i];
          const el = svgEl.querySelector(`[data-node-id="${node.id}"]`);
          if (el) {
            el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
          }
        }

        for (let i = 0; i < currentLinks.length; i++) {
          const link = currentLinks[i];
          const sNode = nMap.get(link.source);
          const tNode = nMap.get(link.target);
          if (!sNode || !tNode) continue;

          const pathEl = svgEl.querySelector(`[data-link-path-id="${link.id}"]`) as SVGPathElement;
          const hitEl = svgEl.querySelector(`[data-link-hit-id="${link.id}"]`) as SVGPathElement;

          const offset = link.offset;
          const curve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, offset);
          if (pathEl) pathEl.setAttribute('d', curve.d);
          if (hitEl) hitEl.setAttribute('d', curve.d);
        }
      }

      // Check if velocities have settled to pause loop (performance optimization & freeze restlessness)
      let totalEnergy = 0;
      for (let i = 0; i < currentNodes.length; i++) {
        totalEnergy += currentNodes[i].vx * currentNodes[i].vx + currentNodes[i].vy * currentNodes[i].vy;
      }

      const averageEnergy = currentNodes.length > 0 ? (totalEnergy / currentNodes.length) : 0;
      if (averageEnergy < 0.0015 && !draggedNodeIdRef.current) {
        if (requestRef.current) {
          cancelAnimationFrame(requestRef.current);
          requestRef.current = null;
        }
        return;
      }

      requestRef.current = requestAnimationFrame(runPhysicsTick);
    };

    runPhysicsTickRef.current = runPhysicsTick;
    requestRef.current = requestAnimationFrame(runPhysicsTick);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      runPhysicsTickRef.current = null;
    };
  }, [nodes.length]);

  // Compute curved Bezier ribbons between nodes
  const getCurvePath = (sX: number, sY: number, tX: number, tY: number, curveOffset = 25) => {
    const midX = (sX + tX) / 2;
    const midY = (sY + tY) / 2;

    // Normal vector components
    const nX = -(tY - sY);
    const nY = (tX - sX);
    const length = Math.sqrt(nX * nX + nY * nY) || 1;

    // Shift control point perpendicular to line (creates a beautiful curve)
    const ctrlX = midX + (nX / length) * curveOffset;
    const ctrlY = midY + (nY / length) * curveOffset;

    return {
      d: `M ${sX} ${sY} Q ${ctrlX} ${ctrlY} ${tX} ${tY}`,
      midX: (midX + ctrlX) / 2,
      midY: (midY + ctrlY) / 2
    };
  };

  // Zoom actions
  const adjustZoom = React.useCallback((zoomFactor: number, focusX?: number, focusY?: number) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const mx = focusX !== undefined ? focusX : rect.width / 2;
    const my = focusY !== undefined ? focusY : rect.height / 2;

    const zoomMin = 0.15;
    const zoomMax = 6.0;

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

  const handleZoomIn = () => adjustZoom(0.2);
  const handleZoomOut = () => adjustZoom(-0.2);
  const handleZoomReset = () => {
    setZoom(1.35);
    const svgEl = svgRef.current;
    if (svgEl) {
      const rect = svgEl.getBoundingClientRect();
      setPan({
        x: rect.width / 2 - (CANVAS_WIDTH / 2) * 1.35,
        y: rect.height / 2 - (CANVAS_HEIGHT / 2) * 1.35
      });
    } else {
      setPan({ x: 0, y: 0 });
    }
  };

  // Dragging Canvas Pan Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target instanceof SVGElement && e.target.closest(`.${styles.nodeContainer}`)) {
      return; // Skip canvas drag if clicking a node
    }
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y
    });
  };

  const handleCanvasMouseUpOrLeave = () => {
    setIsPanning(false);
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
  }, [loading, nodes, adjustZoom]);

  // Node drag handlers (relative to SVG coordinate space)
  const handleNodeMouseDown = (node: Node, e: React.MouseEvent) => {
    e.stopPropagation();
    draggedNodeIdRef.current = node.id;

    // Set initial anchor positions
    node.fx = node.x;
    node.fy = node.y;
    wakePhysics();
  };

  const handleNodeMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggedNodeIdRef.current) return;

    // Find the relative bounding box
    const rect = e.currentTarget.getBoundingClientRect();

    // Map client coordinates to the transformed SVG coordinate space
    const relativeX = (e.clientX - rect.left - pan.x) / zoom;
    const relativeY = (e.clientY - rect.top - pan.y) / zoom;

    const targetNode = nodesRef.current.find(n => n.id === draggedNodeIdRef.current);
    if (targetNode) {
      targetNode.fx = Math.max(targetNode.radius, Math.min(CANVAS_WIDTH - targetNode.radius, relativeX));
      targetNode.fy = Math.max(targetNode.radius, Math.min(CANVAS_HEIGHT - targetNode.radius, relativeY));
    }
    wakePhysics();
  };

  const handleNodeMouseUp = () => {
    draggedNodeIdRef.current = null;
  };

  const handleNodeDoubleClick = (node: Node, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetNode = nodesRef.current.find(n => n.id === node.id);
    if (targetNode) {
      delete targetNode.fx;
      delete targetNode.fy;
    }
    wakePhysics();
  };

  if (!viewingAddress) {
    return <div className={styles.emptyState}>Connect a wallet to view visualizer</div>;
  }

  return (
    <section className={`${styles.card} ${isFullscreen ? styles.fullscreenCard : ''}`}>
      <div className={styles.toolbar}>
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} style={{ backgroundColor: 'rgba(22, 199, 132, 0.25)', borderColor: '#16c784' }} />
            <span>Inflow (Received)</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} style={{ backgroundColor: 'rgba(239, 68, 68, 0.25)', borderColor: '#ff6b6b' }} />
            <span>Outflow (Spent)</span>
          </div>
          {txCount > 0 && (
            <div className={styles.legendItem} style={{ marginLeft: '12px', borderLeft: '1px solid rgba(255, 255, 255, 0.1)', paddingLeft: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
              <span>Visualizing {txCount} Transactions</span>
            </div>
          )}
        </div>

        <div className={styles.controls}>
          <button className={styles.btn} onClick={handleZoomIn} title="Zoom In"><ZoomIn size={14} /></button>
          <button className={styles.btn} onClick={handleZoomOut} title="Zoom Out"><ZoomOut size={14} /></button>
          <button className={styles.btn} onClick={handleZoomReset} title="Reset View"><RotateCcw size={14} /></button>
        </div>
      </div>

      <div className={styles.canvasContainer}>
        {loading ? (
          <div className={styles.loadingScreen}>
            <Loader2 size={36} className={styles.spinner} />
            <p>Constructing Arkham Visualizer Flow...</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className={styles.loadingScreen}>
            <AlertCircle size={32} style={{ color: 'rgba(255,255,255,0.4)', marginBottom: '12px' }} />
            <p>No transaction history to visualize.</p>
          </div>
        ) : (
          <>
            {/* SVG Visualizer Canvas */}
            <svg
              ref={svgRef}
              className={styles.svgCanvas}
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

                {/* 1. Curved Flow Links (Thin Wires with hover hit-areas) */}
                {links.map(link => {
                  const sNode = nodeMapRef.current.get(link.source) || nodes.find(n => n.id === link.source);
                  const tNode = nodeMapRef.current.get(link.target) || nodes.find(n => n.id === link.target);
                  if (!sNode || !tNode) return null;

                  const offset = link.offset;
                  const curve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, offset);

                  const isNetInflow = link.inflowUsd >= link.outflowUsd;
                  const isIncoming = link.direction === 'in' || (link.direction === 'both' && isNetInflow);
                  const dashColor = isIncoming ? '#16c784' : '#ff6b6b';
                  const isHovered = hoveredLink?.id === link.id;

                  return (
                    <g key={link.id} className={styles.linkGroup}>
                      {/* Invisible wide hit-area for hover detection */}
                      <path
                        data-link-hit-id={link.id}
                        d={curve.d}
                        stroke="transparent"
                        strokeWidth={14}
                        fill="none"
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onMouseEnter={(e) => {
                          setHoveredLink(link);
                          const rect = svgRef.current?.getBoundingClientRect();
                          if (rect) {
                            setLinkTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                          }
                        }}
                        onMouseMove={(e) => {
                          const rect = svgRef.current?.getBoundingClientRect();
                          if (rect) {
                            setLinkTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                          }
                        }}
                        onMouseLeave={() => setHoveredLink(null)}
                      />
                      {/* Visible thin wire */}
                      <path
                        data-link-path-id={link.id}
                        d={curve.d}
                        stroke={isHovered ? '#ffffff' : dashColor}
                        strokeWidth={0.5}
                        fill="none"
                        opacity={isHovered ? 1.0 : 0.35}
                        style={{ pointerEvents: 'none', transition: 'stroke 0.15s ease, opacity 0.15s ease' }}
                      />
                    </g>
                  );
                })}

                {/* 2. Interactive Nodes (Sleek and Compact) */}
                {nodes.map(node => {
                  const refNode = nodeMapRef.current.get(node.id) || node;
                  const isCentral = node.type === 'central';
                  const isProtocol = node.type === 'protocol';

                  const nodeBorderColor = isCentral
                    ? '#8B5CF6'
                    : isProtocol
                      ? '#cda169'
                      : '#666';

                  const logoSrc = node.logo;
                  const isLeft = refNode.x < CANVAS_WIDTH / 2;
                  const textX = isLeft ? -refNode.radius - 6 : refNode.radius + 6;
                  const textAnchor = isLeft ? 'end' : 'start';

                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      className={`${styles.nodeContainer} ${hoveredNode?.id === node.id ? styles.nodeHovered : ''}`}
                      transform={`translate(${refNode.x}, ${refNode.y})`}
                      onMouseDown={(e) => handleNodeMouseDown(refNode, e)}
                      onDoubleClick={(e) => handleNodeDoubleClick(refNode, e)}
                      onMouseEnter={() => setHoveredNode(refNode)}
                      onMouseLeave={() => setHoveredNode(null)}
                    >


                      {/* Main node boundary */}
                      <circle
                        r={node.radius}
                        fill="#0d0c0b"
                        stroke={nodeBorderColor}
                        strokeWidth={isCentral ? 2 : 1}
                        className={styles.nodeCircle}
                      />

                      {/* Node Icon */}
                      {logoSrc ? (
                        <clipPath id={`clip-${node.id}`}>
                          <circle r={node.radius - 1.5} />
                        </clipPath>
                      ) : null}

                      {logoSrc ? (
                        <image
                          href={logoSrc}
                          width={(node.radius - 1.5) * 2}
                          height={(node.radius - 1.5) * 2}
                          x={-(node.radius - 1.5)}
                          y={-(node.radius - 1.5)}
                          clipPath={`url(#clip-${node.id})`}
                        />
                      ) : (
                        <g transform="translate(0, 0)">
                          {isCentral ? (
                            <Wallet size={node.radius * 0.8} color="#a78bfa" style={{ transform: `translate(-${node.radius * 0.4}px, -${node.radius * 0.4}px)`, position: 'absolute' } as any} />
                          ) : isProtocol ? (
                            <Cpu size={node.radius * 0.8} color="#e5be8a" style={{ transform: `translate(-${node.radius * 0.4}px, -${node.radius * 0.4}px)`, position: 'absolute' } as any} />
                          ) : (
                            <User size={node.radius * 0.8} color="#888" style={{ transform: `translate(-${node.radius * 0.4}px, -${node.radius * 0.4}px)`, position: 'absolute' } as any} />
                          )}
                        </g>
                      )}


                    </g>
                  );
                })}

              </g>
            </svg>

            {/* Hover Tooltip Overlay (Arkham style info-card) */}
            {hoveredNode && (
              <div className={styles.tooltip}>
                <div className={styles.tooltipTitle}>
                  {hoveredNode.type === 'central' ? 'My Wallet' : hoveredNode.label}
                </div>
                <div className={styles.tooltipAddress}>
                  {hoveredNode.id.startsWith('0x') ? hoveredNode.id : 'Contract Aggregator'}
                </div>
                <div className={styles.tooltipDivider} />
                <div className={styles.tooltipGrid}>
                  <div className={styles.tooltipItem}>
                    <span className={styles.tooltipLabel}>Transactions</span>
                    <span className={styles.tooltipValue}>{hoveredNode.txCount}</span>
                  </div>
                  <div className={styles.tooltipItem}>
                    <span className={styles.tooltipLabel}>Inflow Volume</span>
                    <span className={styles.tooltipValue} style={{ color: '#16c784' }}>
                      ${hoveredNode.inflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className={styles.tooltipItem}>
                    <span className={styles.tooltipLabel}>Outflow Volume</span>
                    <span className={styles.tooltipValue} style={{ color: '#ff6b6b' }}>
                      ${hoveredNode.outflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className={styles.tooltipItem}>
                    <span className={styles.tooltipLabel}>Asset Types</span>
                    <span className={styles.tooltipValue} style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                      {Array.from(hoveredNode.tokens).slice(0, 4).join(', ') || '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Link Hover Tooltip */}
            {hoveredLink && (
              <div
                className={styles.linkTooltip}
                style={{ left: linkTooltipPos.x + 16, top: linkTooltipPos.y - 12 }}
              >
                <div className={styles.linkTooltipHeader}>
                  <span className={styles.linkTooltipCount}>
                    {hoveredLink.txType ? hoveredLink.txType.toUpperCase() : 'TRANSACTION'}
                  </span>
                  <span className={styles.linkTooltipTokens} style={{ fontSize: '10px', opacity: 0.6 }}>
                    {formatDateTime(hoveredLink.timestamp)}
                  </span>
                </div>
                <div className={styles.tooltipDivider} />
                <div className={styles.linkTooltipAmounts}>
                  {hoveredLink.amounts.map((a, i) => (
                    <div key={i} className={styles.linkTooltipRow} style={{ fontSize: '13px', fontWeight: 600 }}>
                      <span style={{ color: a.direction === 'in' ? '#16c784' : '#ff6b6b', marginRight: '4px' }}>
                        {a.direction === 'in' ? '+' : '-'}
                      </span>
                      <span className={styles.linkTooltipAmount}>
                        {a.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {a.token}
                      </span>
                    </div>
                  ))}
                </div>
                {(hoveredLink.inflowUsd > 0 || hoveredLink.outflowUsd > 0) && (
                  <div className={styles.linkTooltipSummary} style={{ marginTop: '4px', fontSize: '11px', opacity: 0.8 }}>
                    Value:{' '}
                    <span style={{ color: hoveredLink.direction === 'in' ? '#16c784' : '#ff6b6b', fontWeight: 600 }}>
                      ${(hoveredLink.inflowUsd || hoveredLink.outflowUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                {hoveredLink.txHash && (
                  <>
                    <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                    <div className={styles.linkTooltipHash} style={{ fontSize: '10px', opacity: 0.5, fontFamily: 'monospace' }}>
                      TX: {truncateHash(hoveredLink.txHash)}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Instructions box in bottom-left */}
            <div className={styles.instructions}>
              <HelpCircle size={12} />
              <span>Scroll to zoom · Drag background to pan · Drag nodes to organize · Hover lines for details</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
