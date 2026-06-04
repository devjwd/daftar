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
  AlertCircle,
  X
} from 'lucide-react';
import { getOrFetchTransactions } from '../../services/transactionService';
import { getProfile } from '../../services/api';
import styles from './VisualizerTab.module.css';
import PlanGate from '../PlanGate';
import { resolveEntityBranding, syncEntities } from '../../services/entityStore';

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
  txs: { direction: 'in' | 'out'; offset: number; amounts: { amount: number; token: string; direction: 'in' | 'out' }[] }[];
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

const isJunkAsset = (symbol: string): boolean => {
  if (!symbol) return true;
  const sym = symbol.trim();
  const symLower = sym.toLowerCase();

  // Scam / test / illiquid tokens
  const blacklisted = [
    'test', 'capy', 'movecat', 'lmove', 'dmove',
    'move drops', 'move drop', 'move gift', 'move rwd', 'movereward',
    'movedrop', 'movegift', 'moverwd', 'movereward'
  ];
  if (blacklisted.includes(symLower)) return true;

  // LP token patterns in symbol
  const lpPatterns = ['lp', 'lpt', 'lptoken', 'pooltoken', 'pool_token', 'liquidity', 'pair', 'pool-token'];
  if (lpPatterns.some(p => symLower === p || symLower.includes('-' + p) || symLower.includes('_' + p) || symLower.includes(' ' + p) || symLower.includes(p + '-') || symLower.includes(p + '_') || symLower.includes(p + ' '))) return true;
  if (symLower.endsWith('lp') || symLower.startsWith('lp')) return true;

  // Lending Receipt Tokens (eMOVE, jMOVE, uMOVE, pmMOVE, etc.)
  const baseSymbols = ['move', 'usdt', 'usdc', 'eth', 'btc', 'weth', 'usdt.e', 'usdc.e'];
  for (const base of baseSymbols) {
    if (symLower === `e${base}` || symLower === `j${base}` || symLower === `u${base}` || symLower === `pm${base}`) return true;
  }

  // LP NFT and position patterns in symbol
  const nftPositionPatterns = ['position', 'pos', 'lp-nft', 'lpnft', 'badge', 'ticket', 'card', 'nft'];
  if (nftPositionPatterns.some(p => symLower === p || symLower.includes(p) || symLower.includes('-' + p) || symLower.includes('_' + p))) return true;

  return false;
};

interface VisualizerTabProps {
  viewingAddress: string | null;
  language?: string;
  isFullscreen?: boolean;
}

export default function VisualizerTab({ viewingAddress, language = 'en', isFullscreen = false }: VisualizerTabProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState<'free' | 'lite' | 'pro' | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStepText, setLoadingStepText] = useState('Constructing Visualizer Flow...');

  useEffect(() => {
    if (!loading) return;
    const steps = [
      'Constructing Visualizer Flow...',
      'Mapping transaction nodes...',
      'Simulating physics layout...',
      'Optimizing connection graph...'
    ];
    let stepIndex = 0;
    const interval = setInterval(() => {
      stepIndex = (stepIndex + 1) % steps.length;
      setLoadingStepText(steps[stepIndex]);
    }, 1200);
    return () => clearInterval(interval);
  }, [loading]);

  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [hoveredLink, setHoveredLink] = useState<Link | null>(null);
  const [hoveredTx, setHoveredTx] = useState<{ linkId: string; offset: number; text: string } | null>(null);
  const [linkTooltipPos, setLinkTooltipPos] = useState({ x: 0, y: 0 });
  const [nodeTooltipPos, setNodeTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedLink, setSelectedLink] = useState<Link | null>(null);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
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
  const nodeElementsRef = useRef<Map<string, SVGElement>>(new Map());
  const linkInflowElementsRef = useRef<Map<string, SVGPathElement>>(new Map());
  const linkOutflowElementsRef = useRef<Map<string, SVGPathElement>>(new Map());
  const linkHitElementsRef = useRef<Map<string, SVGPathElement>>(new Map());
  const runPhysicsTickRef = useRef<(() => void) | null>(null);

  const wakePhysics = () => {
    if (!requestRef.current && runPhysicsTickRef.current && nodesRef.current.length > 0) {
      requestRef.current = requestAnimationFrame(runPhysicsTickRef.current);
    }
  };

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 500;

  // Fetch subscription tier on address change
  useEffect(() => {
    if (!viewingAddress) {
      setSubscriptionTier(null);
      return;
    }
    let isMounted = true;
    getProfile(viewingAddress)
      .then(profile => {
        if (isMounted) {
          const tier = profile?.subscription_tier || (profile?.is_verified ? 'pro' : 'free');
          setSubscriptionTier(tier === 'lite' ? 'pro' : tier);
        }
      })
      .catch(err => {
        console.warn("Failed to fetch profile subscription tier:", err);
        if (isMounted) setSubscriptionTier('free');
      });
    return () => {
      isMounted = false;
    };
  }, [viewingAddress]);

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
        // Ensure entities cache is synced before resolving branding
        try {
          await syncEntities();
        } catch (e) {
          console.warn("Failed to sync Supabase entities:", e);
        }

        let isPremium = false;
        try {
          const profile = await getProfile(viewingAddress);
          if (profile) {
            const rawTier = profile.subscription_tier || (profile.is_verified ? 'pro' : 'free');
            const tier = rawTier === 'lite' ? 'pro' : rawTier;
            isPremium = tier !== 'free';
          }
        } catch (e) {
          console.warn("Failed to fetch profile subscription status:", e);
        }

        let txs: any[] = [];
        if (isPremium) {
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

        const linksMap = new Map<string, {
          id: string;
          source: string;
          target: string;
          txCount: number;
          inflowUsd: number;
          outflowUsd: number;
          tokens: Set<string>;
          direction: 'in' | 'out' | 'both';
          amountsMap: Map<string, { amount: number; token: string; direction: 'in' | 'out' }>;
          txHash?: string;
          txType?: string;
          timestamp?: string;
          rawTxs: { direction: 'in' | 'out'; amounts: { amount: number; token: string; direction: 'in' | 'out' }[] }[];
        }>();

        txs.forEach((tx: any) => {
          // Skip pure junk/LP transactions
          const tokenIn = tx.token_in;
          const tokenOut = tx.token_out;
          const hasTokenIn = !!tokenIn;
          const hasTokenOut = !!tokenOut;
          if ((hasTokenIn || hasTokenOut) &&
              (!hasTokenIn || isJunkAsset(tokenIn)) &&
              (!hasTokenOut || isJunkAsset(tokenOut))) {
            return;
          }

          // Check if counterparty is a known entity first to get logo & label
          let addressToCheck = '';
          if (tx.counterparty_address) {
            addressToCheck = tx.counterparty_address;
          } else if (tx.dapp_contract) {
            addressToCheck = tx.dapp_contract;
          } else if (tx.sender && tx.sender.toLowerCase() !== centerId) {
            addressToCheck = tx.sender;
          }

          const branding = addressToCheck ? resolveEntityBranding(addressToCheck) : null;

          // Identify counterparty / protocol
          let counterpartyId = '';
          let label = '';
          let type: 'wallet' | 'protocol' = 'wallet';
          let logo = null;

          if (branding) {
            counterpartyId = addressToCheck.toLowerCase();
            label = branding.name;
            type = 'protocol';
            logo = branding.logo;
          } else if (tx.dapp_key && tx.dapp_name && tx.dapp_name !== 'Wallet') {
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

          const hasInflow = tx.tx_type === 'received' || (tx.amount_out != null && Number(tx.amount_out) > 0);
          const hasOutflow = tx.tx_type === 'send' || (tx.amount_in != null && Number(tx.amount_in) > 0);
          const usdValue = Math.max(Number(tx.amount_in_usd || 0), Number(tx.amount_out_usd || 0), Number(tx.pnl_usd || 0));

          const currentAmounts: { amount: number; token: string; direction: 'in' | 'out' }[] = [];
          if (hasInflow) {
            const amount = Number(tx.amount_out || tx.amount_in || 0);
            const token = tx.token_out || tx.token_in || 'MOVE';
            if (amount > 0 && !isJunkAsset(token)) {
              currentAmounts.push({ amount, token, direction: 'in' });
            }
          }
          if (hasOutflow) {
            const amount = Number(tx.amount_in || tx.amount_out || 0);
            const token = tx.token_in || tx.token_out || 'MOVE';
            if (amount > 0 && !isJunkAsset(token)) {
              currentAmounts.push({ amount, token, direction: 'out' });
            }
          }

          if (currentAmounts.length === 0) return; // Skip zero-value links

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
          if (hasInflow) {
            nodeData.inflowUsd += usdValue;
            currentAmounts.filter(a => a.direction === 'in').forEach(a => nodeData.tokens.add(a.token));
          } else {
            nodeData.outflowUsd += usdValue;
            currentAmounts.filter(a => a.direction === 'out').forEach(a => nodeData.tokens.add(a.token));
          }

          // 2. Update aggregated link details
          if (!linksMap.has(counterpartyId)) {
            linksMap.set(counterpartyId, {
              id: `link-${counterpartyId}`,
              source: counterpartyId,
              target: centerId,
              txCount: 0,
              inflowUsd: 0,
              outflowUsd: 0,
              tokens: new Set<string>(),
              direction: 'in',
              amountsMap: new Map<string, { amount: number; token: string; direction: 'in' | 'out' }>(),
              txHash: tx.tx_hash,
              txType: tx.tx_type,
              timestamp: tx.tx_timestamp,
              rawTxs: []
            });
          }

          const linkData = linksMap.get(counterpartyId)!;
          linkData.txCount++;
          linkData.inflowUsd += hasInflow ? usdValue : 0;
          linkData.outflowUsd += hasOutflow ? usdValue : 0;
          linkData.rawTxs.push({ direction: hasInflow ? 'in' : 'out', amounts: currentAmounts });

          currentAmounts.forEach(a => {
            linkData.tokens.add(a.token);
            const key = `${a.token}-${a.direction}`;
            if (!linkData.amountsMap.has(key)) {
              linkData.amountsMap.set(key, { amount: 0, token: a.token, direction: a.direction });
            }
            linkData.amountsMap.get(key)!.amount += a.amount;
          });

          // Keep latest active transaction
          if (!linkData.timestamp || new Date(tx.tx_timestamp) > new Date(linkData.timestamp)) {
            linkData.timestamp = tx.tx_timestamp;
            linkData.txHash = tx.tx_hash;
            linkData.txType = tx.tx_type;
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
          tokens: new Set(txs.map((tx: any) => tx.token_in || tx.token_out).filter((t: string) => t && !isJunkAsset(t)))
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
            radius: data.logo 
              ? Math.min(22, Math.max(14, 14 + data.txCount * 0.4)) 
              : Math.min(14, Math.max(8, 8 + data.txCount * 0.5)),
            txCount: data.txCount,
            inflowUsd: data.inflowUsd,
            outflowUsd: data.outflowUsd,
            tokens: data.tokens
          };
        });

        const allNodes = [centralNode, ...outerNodes];

        // Convert the aggregated linksMap to the final Link[] array
        const allLinks: Link[] = Array.from(linksMap.values()).map(linkData => {
          const finalDirection: 'in' | 'out' | 'both' = 
            linkData.inflowUsd > 0 && linkData.outflowUsd > 0 
              ? 'both' 
              : linkData.inflowUsd > 0 
                ? 'in' 
                : 'out';

          // Pre-calculate offsets for each individual transaction line of this counterparty
          const total = linkData.rawTxs.length;
          const txsWithOffsets = linkData.rawTxs.map((tx, index) => {
            let offset = 15;
            if (total > 1) {
              const spread = Math.min(120, total * 8.0);
              const start = -spread / 2;
              const step = spread / (total - 1);
              offset = start + index * step;
            }
            return {
              direction: tx.direction,
              offset,
              amounts: tx.amounts
            };
          });

          return {
            id: linkData.id,
            source: linkData.source,
            target: linkData.target,
            txCount: linkData.txCount,
            inflowUsd: linkData.inflowUsd,
            outflowUsd: linkData.outflowUsd,
            tokens: linkData.tokens,
            direction: finalDirection,
            amounts: Array.from(linkData.amountsMap.values()),
            txs: txsWithOffsets,
            txHash: linkData.txHash,
            txType: linkData.txType,
            timestamp: linkData.timestamp
          };
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

        node.x = node.x + node.vx;
        node.y = node.y + node.vy;
        node.vx = Math.max(-maxV, Math.min(maxV, node.vx * damping));
        node.vy = Math.max(-maxV, Math.min(maxV, node.vy * damping));
      }

      // UPDATE SVG DOM DIRECTLY (bypasses React render overhead)
      for (let i = 0; i < currentNodes.length; i++) {
        const node = currentNodes[i];
        const el = nodeElementsRef.current.get(node.id);
        if (el) {
          el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
        }
      }

      for (let i = 0; i < currentLinks.length; i++) {
        const link = currentLinks[i];
        const sNode = nMap.get(link.source);
        const tNode = nMap.get(link.target);
        if (!sNode || !tNode) continue;

        let inflowD = '';
        let outflowD = '';

        link.txs.forEach(tx => {
          const curve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, tx.offset);
          if (tx.direction === 'in') {
            inflowD += (inflowD ? ' ' : '') + curve.d;
          } else {
            outflowD += (outflowD ? ' ' : '') + curve.d;
          }
        });

        const inflowEl = linkInflowElementsRef.current.get(link.id);
        const outflowEl = linkOutflowElementsRef.current.get(link.id);
        const hitEl = linkHitElementsRef.current.get(link.id);

        if (inflowEl) inflowEl.setAttribute('d', inflowD);
        if (outflowEl) outflowEl.setAttribute('d', outflowD);

        const compoundD = (inflowD && outflowD) ? `${inflowD} ${outflowD}` : (inflowD || outflowD);
        if (hitEl) hitEl.setAttribute('d', compoundD || getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, 15).d);
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
      targetNode.fx = relativeX;
      targetNode.fy = relativeY;
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

  if (subscriptionTier === 'free') {
    return (
      <section className={`${styles.card} ${isFullscreen ? styles.fullscreenCard : ''}`}>
        <div className={styles.canvasContainer} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px', padding: '40px' }}>
          <PlanGate
            feature="Transaction Visualizer"
            description="Upgrade to Pro to visualize your transaction flows on-chain, see interactive connection graphs, and track funds."
            requiredTier="pro"
          />
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${isFullscreen ? styles.fullscreenCard : ''}`}>
      <div className={styles.canvasContainer}>
        {!loading && nodes.length > 0 && (
          <div className={styles.controls} style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 65 }}>
            <button className={styles.btn} onClick={handleZoomIn} title="Zoom In"><ZoomIn size={14} /></button>
            <button className={styles.btn} onClick={handleZoomOut} title="Zoom Out"><ZoomOut size={14} /></button>
            <button className={styles.btn} onClick={handleZoomReset} title="Reset View"><RotateCcw size={14} /></button>
          </div>
        )}
        {loading ? (
          <div className={styles.loadingScreen}>
            <div className={styles.visualizerLoaderContainer}>
              <div className={styles.networkLogoAnimation}>
                <svg width="120" height="120" viewBox="0 0 100 100" className={styles.svgLoader}>
                  {/* Central Node */}
                  <circle cx="50" cy="50" r="10" className={styles.centralPulseNode} />
                  
                  {/* Connecting Lines */}
                  <line x1="50" y1="50" x2="25" y2="25" className={styles.loaderLine1} />
                  <line x1="50" y1="50" x2="75" y2="30" className={styles.loaderLine2} />
                  <line x1="50" y1="50" x2="65" y2="75" className={styles.loaderLine3} />
                  <line x1="50" y1="50" x2="30" y2="65" className={styles.loaderLine4} />
                  
                  {/* Surrounding Nodes */}
                  <circle cx="25" cy="25" r="5" className={styles.pulseNode1} />
                  <circle cx="75" cy="30" r="6" className={styles.pulseNode2} />
                  <circle cx="65" cy="75" r="4" className={styles.pulseNode3} />
                  <circle cx="30" cy="65" r="5" className={styles.pulseNode4} />
                </svg>
              </div>
              <h3 className={styles.loadingTitle}>Building Visualizer</h3>
              <div className={styles.statusStepper}>
                <div className={styles.statusBar}>
                  <div className={styles.statusBarProgress} />
                </div>
                <p className={styles.loadingSubtitle}>{loadingStepText}</p>
              </div>
            </div>
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
              onClick={() => {
                setSelectedNode(null);
                setSelectedLink(null);
                setSelectedTx(null);
              }}
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

                  // Build initial compound paths
                  let inflowD = '';
                  let outflowD = '';
                  link.txs.forEach(tx => {
                    const curve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, tx.offset);
                    if (tx.direction === 'in') {
                      inflowD += (inflowD ? ' ' : '') + curve.d;
                    } else {
                      outflowD += (outflowD ? ' ' : '') + curve.d;
                    }
                  });

                  const centerCurve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, 15);
                  const compoundD = (inflowD && outflowD) ? `${inflowD} ${outflowD}` : (inflowD || outflowD || centerCurve.d);
                  const isHovered = hoveredLink?.id === link.id;

                  return (
                    <g
                      key={link.id}
                      className={styles.linkGroup}
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
                      onMouseLeave={() => {
                        setHoveredLink(null);
                        setHoveredTx(null);
                      }}
                    >
                      {/* Invisible wide hit-area for hover detection (connection level) */}
                      <path
                        ref={el => {
                          if (el) linkHitElementsRef.current.set(link.id, el);
                          else linkHitElementsRef.current.delete(link.id);
                        }}
                        data-link-hit-id={link.id}
                        d={compoundD}
                        stroke="transparent"
                        strokeWidth={10}
                        fill="none"
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLink(link);
                          setSelectedNode(null);
                          setSelectedTx(null);
                        }}
                      />

                      {/* Inflow Visible compound path */}
                      {inflowD && (
                        <path
                          ref={el => {
                            if (el) linkInflowElementsRef.current.set(link.id, el);
                            else linkInflowElementsRef.current.delete(link.id);
                          }}
                          d={inflowD}
                          stroke="#16c784"
                          strokeWidth={0.15}
                          fill="none"
                          opacity={isHovered ? 0.55 : 0.15}
                          style={{ pointerEvents: 'none', transition: 'opacity 0.15s ease' }}
                        />
                      )}

                      {/* Outflow Visible compound path */}
                      {outflowD && (
                        <path
                          ref={el => {
                            if (el) linkOutflowElementsRef.current.set(link.id, el);
                            else linkOutflowElementsRef.current.delete(link.id);
                          }}
                          d={outflowD}
                          stroke="#ff6b6b"
                          strokeWidth={0.15}
                          fill="none"
                          opacity={isHovered ? 0.55 : 0.15}
                          style={{ pointerEvents: 'none', transition: 'opacity 0.15s ease' }}
                        />
                      )}

                      {/* Individual Hit-test paths (Rendered only when connection is hovered) */}
                      {isHovered && link.txs.map((tx, index) => {
                        const txCurve = getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, tx.offset);
                        return (
                          <path
                            key={index}
                            d={txCurve.d}
                            stroke="transparent"
                            strokeWidth={8}
                            fill="none"
                            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTx(tx);
                              setSelectedLink(link);
                              setSelectedNode(null);
                            }}
                            onMouseEnter={() => {
                              const text = tx.amounts && tx.amounts.length > 0
                                ? tx.amounts.map(a => `${a.direction === 'in' ? '+' : '-'} ${a.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${a.token}`).join(' | ')
                                : 'Transaction';
                              
                              setHoveredTx({
                                linkId: link.id,
                                offset: tx.offset,
                                text
                              });
                            }}
                            onMouseLeave={() => {
                              setHoveredTx(null);
                            }}
                          />
                        );
                      })}

                      {/* Selected Sub-Line (Gold) */}
                      {selectedTx && selectedLink?.id === link.id && (
                        <path
                          d={getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, selectedTx.offset).d}
                          stroke="#cda169"
                          strokeWidth={0.15}
                          fill="none"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}

                      {/* White Highlighted Hovered Sub-Line */}
                      {hoveredTx && hoveredTx.linkId === link.id && (!selectedTx || selectedTx.offset !== hoveredTx.offset) && (
                        <path
                          d={getCurvePath(sNode.x, sNode.y, tNode.x, tNode.y, hoveredTx.offset).d}
                          stroke="#ffffff"
                          strokeWidth={0.15}
                          fill="none"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
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
                      ref={el => {
                        if (el) nodeElementsRef.current.set(node.id, el);
                        else nodeElementsRef.current.delete(node.id);
                      }}
                      data-node-id={node.id}
                      className={`${styles.nodeContainer} ${hoveredNode?.id === node.id ? styles.nodeHovered : ''}`}
                      transform={`translate(${refNode.x}, ${refNode.y})`}
                      onMouseDown={(e) => handleNodeMouseDown(refNode, e)}
                      onDoubleClick={(e) => handleNodeDoubleClick(refNode, e)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNode(refNode);
                        setSelectedLink(null);
                        setSelectedTx(null);
                      }}
                      onMouseEnter={(e) => {
                        setHoveredNode(refNode);
                        const rect = svgRef.current?.getBoundingClientRect();
                        if (rect) {
                          setNodeTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }
                      }}
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

            {/* Hover Tooltip Overlay (Minimal capsule next to pointer) */}
            {hoveredNode && (
              <div
                className={styles.minimalTooltip}
                style={{ 
                  left: nodeTooltipPos.x + 12, 
                  top: nodeTooltipPos.y - 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  alignItems: 'flex-start',
                  padding: '6px 10px'
                }}
              >
                <span style={{ fontWeight: 600, color: '#f3dfbe' }}>
                  {hoveredNode.type === 'central' ? 'My Wallet' : hoveredNode.label}
                </span>
                <span style={{ fontSize: '10px', opacity: 0.7, fontFamily: 'monospace' }}>
                  {hoveredNode.txCount} {hoveredNode.txCount === 1 ? 'Transaction' : 'Transactions'}
                  {hoveredNode.inflowUsd > 0 && ` | +$${hoveredNode.inflowUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  {hoveredNode.outflowUsd > 0 && ` | -$${hoveredNode.outflowUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </span>
              </div>
            )}

            {hoveredLink && (
              <div
                className={styles.minimalTooltip}
                style={{ left: linkTooltipPos.x + 12, top: linkTooltipPos.y - 8 }}
              >
                {hoveredTx ? (
                  <span
                    style={{
                      color: hoveredTx.text.startsWith('+') ? '#16c784' : '#ff6b6b',
                      fontWeight: 600,
                    }}
                  >
                    {hoveredTx.text}
                  </span>
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {hoveredLink.txCount} {hoveredLink.txCount === 1 ? 'Transaction' : 'Transactions'}
                  </span>
                )}
              </div>
            )}

            {/* Pinned Selection Panel in Top-Left (Triggered on Click) */}
            {(selectedNode || selectedLink) && (
              <div className={styles.selectionPanel}>
                <div className={styles.selectionPanelHeader}>
                  <span>{selectedNode ? 'Wallet Details' : selectedTx ? 'Transaction Details' : 'Connection Details'}</span>
                  <button
                    className={styles.closePanelBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(null);
                      setSelectedLink(null);
                      setSelectedTx(null);
                    }}
                    title="Close Details"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className={styles.tooltipDivider} style={{ margin: '8px 0' }} />

                {selectedNode && (
                  <div>
                    <div className={styles.tooltipTitle} style={{ fontSize: '14px', marginBottom: '4px' }}>
                      {selectedNode.type === 'central' ? 'My Wallet' : selectedNode.label}
                    </div>
                    <div className={styles.tooltipAddress} style={{ wordBreak: 'break-all', marginBottom: '12px', fontSize: '10px', opacity: 0.5 }}>
                      {selectedNode.id}
                    </div>
                    <div className={styles.tooltipGrid}>
                      <div className={styles.tooltipItem}>
                        <span className={styles.tooltipLabel}>Transactions</span>
                        <span className={styles.tooltipValue}>{selectedNode.txCount}</span>
                      </div>
                      <div className={styles.tooltipItem}>
                        <span className={styles.tooltipLabel}>Inflow Volume</span>
                        <span className={styles.tooltipValue} style={{ color: '#16c784' }}>
                          ${selectedNode.inflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className={styles.tooltipItem}>
                        <span className={styles.tooltipLabel}>Outflow Volume</span>
                        <span className={styles.tooltipValue} style={{ color: '#ff6b6b' }}>
                          ${selectedNode.outflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className={styles.tooltipItem}>
                        <span className={styles.tooltipLabel}>Asset Types</span>
                        <span className={styles.tooltipValue} style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                          {Array.from(selectedNode.tokens).slice(0, 4).join(', ') || '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedLink && (
                  <div>
                    {selectedTx ? (
                      <div>
                        <div className={styles.linkTooltipHeader} style={{ marginBottom: '6px' }}>
                          <span className={styles.linkTooltipCount} style={{ fontSize: '13px', fontWeight: 700, color: '#f3dfbe' }}>
                            TRANSACTION FLOW
                          </span>
                          <span className={styles.linkTooltipTokens} style={{ fontSize: '9px', opacity: 0.5, textTransform: 'uppercase' }}>
                            {selectedTx.txType || 'transfer'}
                          </span>
                        </div>
                        <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                        <div className={styles.tooltipGrid} style={{ marginBottom: '8px' }}>
                          {selectedTx.usdValue !== undefined && selectedTx.usdValue > 0 && (
                            <div className={styles.tooltipItem}>
                              <span className={styles.tooltipLabel}>USD Value</span>
                              <span className={styles.tooltipValue} style={{ color: '#fff' }}>
                                ${selectedTx.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          )}
                          <div className={styles.tooltipItem}>
                            <span className={styles.tooltipLabel}>Direction</span>
                            <span className={styles.tooltipValue} style={{ color: selectedTx.direction === 'in' ? '#16c784' : '#ff6b6b', fontWeight: 600 }}>
                              {selectedTx.direction === 'in' ? 'INFLOW (Received)' : 'OUTFLOW (Sent)'}
                            </span>
                          </div>
                          <div className={styles.tooltipItem}>
                            <span className={styles.tooltipLabel}>Time</span>
                            <span className={styles.tooltipValue} style={{ fontSize: '10px' }}>
                              {formatDateTime(selectedTx.timestamp)}
                            </span>
                          </div>
                        </div>

                        <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                        <div className={styles.linkTooltipCount} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                          Transfers
                        </div>
                        <div className={styles.linkTooltipAmounts} style={{ margin: '6px 0', maxHeight: '120px', overflowY: 'auto' }}>
                          {selectedTx.amounts.map((a: any, i: number) => (
                            <div key={i} className={styles.linkTooltipRow} style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ color: a.direction === 'in' ? '#16c784' : '#ff6b6b', marginRight: '4px' }}>
                                {a.direction === 'in' ? '+' : '-'}
                              </span>
                              <span className={styles.linkTooltipAmount}>
                                {a.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {a.token}
                              </span>
                            </div>
                          ))}
                        </div>
                        {selectedTx.txHash && (
                          <>
                            <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                            <div className={styles.linkTooltipRow} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className={styles.tooltipLabel} style={{ fontSize: '9px', opacity: 0.4 }}>TX Hash</span>
                              <a
                                href={`https://explorer.movementnetwork.xyz/txn/${selectedTx.txHash.replace(/^v/i, '')}?network=mainnet`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.closePanelBtn}
                                style={{
                                  fontSize: '10px',
                                  color: '#cda169',
                                  textDecoration: 'underline',
                                  fontFamily: 'monospace',
                                  background: 'rgba(205, 161, 105, 0.1)',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  display: 'inline-block'
                                }}
                              >
                                {truncateHash(selectedTx.txHash)} ↗
                              </a>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className={styles.linkTooltipHeader} style={{ marginBottom: '6px' }}>
                          <span className={styles.linkTooltipCount} style={{ fontSize: '13px', fontWeight: 700, color: '#f3dfbe' }}>
                            CONNECTION FLOW
                          </span>
                          <span className={styles.linkTooltipTokens} style={{ fontSize: '9px', opacity: 0.5 }}>
                            {selectedLink.txCount} {selectedLink.txCount === 1 ? 'tx' : 'txs'}
                          </span>
                        </div>
                        <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                    <div className={styles.tooltipGrid} style={{ marginBottom: '8px' }}>
                      {selectedLink.inflowUsd > 0 && (
                        <div className={styles.tooltipItem}>
                          <span className={styles.tooltipLabel}>Total Inflow</span>
                          <span className={styles.tooltipValue} style={{ color: '#16c784' }}>
                            ${selectedLink.inflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      {selectedLink.outflowUsd > 0 && (
                        <div className={styles.tooltipItem}>
                          <span className={styles.tooltipLabel}>Total Outflow</span>
                          <span className={styles.tooltipValue} style={{ color: '#ff6b6b' }}>
                            ${selectedLink.outflowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <div className={styles.tooltipItem}>
                        <span className={styles.tooltipLabel}>Last Active</span>
                        <span className={styles.tooltipValue} style={{ fontSize: '10px' }}>
                          {formatDateTime(selectedLink.timestamp)}
                        </span>
                      </div>
                    </div>

                    <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                    <div className={styles.linkTooltipCount} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                      Net Transfers
                    </div>
                    <div className={styles.linkTooltipAmounts} style={{ margin: '6px 0', maxHeight: '120px', overflowY: 'auto' }}>
                      {selectedLink.amounts.map((a, i) => (
                        <div key={i} className={styles.linkTooltipRow} style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ color: a.direction === 'in' ? '#16c784' : '#ff6b6b', marginRight: '4px' }}>
                            {a.direction === 'in' ? '+' : '-'}
                          </span>
                          <span className={styles.linkTooltipAmount}>
                            {a.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {a.token}
                          </span>
                        </div>
                      ))}
                    </div>
                    {selectedLink.txHash && (
                      <>
                        <div className={styles.tooltipDivider} style={{ margin: '6px 0' }} />
                        <div className={styles.linkTooltipHash} style={{ fontSize: '9px', opacity: 0.4, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          Last TX: {truncateHash(selectedLink.txHash)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

            {/* Instructions box in bottom-left */}
            <div className={styles.instructions}>
              <HelpCircle size={12} />
              <span>Scroll to zoom · Drag background to pan · Drag nodes to organize · Double-click node to pin/unpin · Hover lines for details</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
