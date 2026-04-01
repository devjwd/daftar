-- Badge definitions stored in DB (mirrors on-chain badge config)
CREATE TABLE IF NOT EXISTS badge_definitions (
  id SERIAL PRIMARY KEY,
  badge_id INTEGER NOT NULL UNIQUE,        -- matches on-chain badge ID
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  rarity TEXT NOT NULL DEFAULT 'COMMON',   -- COMMON/UNCOMMON/RARE/EPIC/LEGENDARY
  xp_value INTEGER NOT NULL DEFAULT 10,
  rule_type TEXT NOT NULL,                 -- matches CRITERIA_TYPES from badges.js
  rule_params JSONB NOT NULL DEFAULT '{}', -- flexible params per rule type
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attestation log (prevents re-verification abuse)
CREATE TABLE IF NOT EXISTS badge_attestations (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  badge_id INTEGER NOT NULL,
  eligible BOOLEAN NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  proof_hash TEXT,
  UNIQUE(wallet_address, badge_id)
);

-- RLS policies
ALTER TABLE badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read badge definitions"
ON badge_definitions FOR SELECT USING (true);

CREATE POLICY "Service role manages attestations"
ON badge_attestations FOR ALL USING (true);

CREATE POLICY "Service role manages badge definitions"
ON badge_definitions FOR ALL USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attestations_wallet 
ON badge_attestations(wallet_address);

CREATE INDEX IF NOT EXISTS idx_attestations_badge 
ON badge_attestations(badge_id);

CREATE INDEX IF NOT EXISTS idx_definitions_badge_id 
ON badge_definitions(badge_id);
