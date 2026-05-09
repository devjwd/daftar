/**
 * Unified Type Definitions for Daftar Project
 */

export interface Profile {
  wallet_address: string;
  username: string;
  bio: string;
  avatar_url: string | null;
  twitter: string;
  telegram: string;
  xp: number;
  created_at?: string;
  updated_at?: string;
}

export type BadgeRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BadgeDefinition {
  badge_id: string;
  id?: string; // Client-side alias
  name: string;
  description: string;
  image_url: string;
  xp_value: number;
  mint_fee: number;
  on_chain_badge_id: number | null;
  onChainBadgeId?: number | null; // Client-side alias
  criteria: BadgeCriterion[];
  metadata: Record<string, any>;
  is_public: boolean;
  enabled: boolean;
  is_active: boolean;
  rule_type: number;
  rule_params: Record<string, any>;
  rarity?: BadgeRarity;
  earned?: boolean; // Client-side state
  metadata_uri?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BadgeCriterion {
  type: string;
  rule_type: number;
  params: Record<string, any>;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  progress?: {
    current: number;
    target: number;
  };
  fromCache?: boolean;
  error?: string;
}

export interface MintSignatureResponse {
  signatureBytes: number[];
  validUntil: number;
  signerEpoch: number;
  nonce: number;
  badge_id: number;
  user_address: string;
}

export interface MovementTransaction {
  tx_hash: string;
  wallet_address: string;
  tx_type: 'swap' | 'transfer' | 'mint' | 'other';
  dapp_name: string;
  status: string;
  tx_timestamp: string;
  amount_in_usd?: number;
  amount_out_usd?: number;
}

export interface LeaderboardEntry {
  wallet_address: string;
  username: string;
  avatar_url: string | null;
  xp: number;
  rank: number;
}

