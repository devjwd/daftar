# Hybrid Badge Verification Architecture

## Overview

The Movement Network Portfolio Manager uses a **hybrid off-chain/on-chain badge verification system** that computes trading activity metrics off-chain via the Movement Indexer, stores eligibility snapshots in an off-chain allowlist, and verifies mint eligibility on-chain via the Aptos-compatible badges.move contract.

**Rationale:**
- On-chain storage is expensive and evolves slowly; badge rules must adapt (new seasons, thresholds).
- Indexer data is event-based and immutable, providing ground truth for user activity.
- Off-chain computation is flexible and enables complex analytics (transaction grouping, USD valuation, anti-gaming).
- On-chain allowlist (OFFCHAIN_ALLOWLIST rule) ensures mint eligibility is deterministic and cannot be replayed.

---

## High-Level Data Flow

```
Movement Network Indexer
    ↓
[getRecentTransactions GraphQL]
    ↓
  Fungible asset activities, transaction versions, owner addresses
    ↓
[eligibilityService.getTradingMetrics()]
    ↓
  Off-Chain Metric Computation:
    • buildTradeGroups() → group activities by transaction_version
    • summarizeTradeGroups() → detect multi-token swaps, calc USD values
    • Outputs: tradesCount, activeTradingDays, uniqueTokensTraded, totalVolumeUsd
    ↓
[badgeService.checkEligibility() or Admin.handleCheckEligibility()]
    ↓
  Eligibility Decision & Allowlist Snapshot:
    • Evaluate metrics against badge tier thresholds
    • If eligible, add to allowlist with signature/proof
    ↓
[On-Chain: badges.move contract]
    ↓
  Mint SBT:
    • Verify owner in OFFCHAIN_ALLOWLIST or MIN_BALANCE rules
    • Emit BadgeMinted event
    • Store in BadgeStore for user
```

---

## Metric Definitions

### 1. Trade Count (`tradesCount`)

**Definition:** Number of distinct swap transactions detected in user's activity history.

**Computation:**
1. Fetch fungible asset activities via `getRecentTransactions(owner, limit=1000)`.
2. Group activities by `transaction_version` (primary) or `(owner_address, timestamp, block_height)` (fallback).
3. For each group, count distinct asset types (e.g., MOVEMENT, USDC, WETH).
4. If group has ≥2 distinct assets, classify as 1 trade.
5. Sum all trade-classified groups.

**Anti-Gaming Rule:**
- Minimum volume per trade: $1 USD equivalent (see `MIN_VOLUME_PER_TRADE` in `constants.js`).
- Trade must involve >1 distinct token (not self-transfer).
- Prevents dust trading (e.g., 0.0001 MOVE swaps).

**Implementation:**
- See `buildTradeGroups()` and `summarizeTradeGroups()` in `eligibilityService.js`.
- Returns `{tradesCount, evaluatedTrades: [{timestamp, assets, usdVolume, ...}]}` for audit.

---

### 2. Active Trading Days (`activeTradingDays`)

**Definition:** Count of distinct UTC calendar days on which the user conducted at least one trade.

**Computation:**
1. For each trade identified in tradesCount computation.
2. Normalize timestamp to UTC date key: `YYYY-MM-DD` format (see `toUtcDayKey()`).
3. Add to Set<string> to deduplicate.
4. Return set cardinality.

**Anti-Gaming Rule:**
- Only days with ≥1 qualifying trade (min $1 volume) count.
- Timestamp must be verifiable from indexer (no future or zero timestamps).

**Example:**
```
Trade 1: 2025-01-15 10:30 UTC → day "2025-01-15"
Trade 2: 2025-01-15 15:45 UTC → day "2025-01-15" (deduped)
Trade 3: 2025-01-16 08:00 UTC → day "2025-01-16"
Trade 4: 2025-01-18 18:20 UTC → day "2025-01-18" (gap: 2025-01-17 skipped)
Result: 3 active trading days
```

**Implementation:**
- See `toUtcDayKey()` helper and `summarizeTradeGroups()` in `eligibilityService.js`.
- Robust against millisecond/second timestamp variance via `parseTimestampMs()`.

---

### 3. Trading Volume (`totalVolumeUsd`)

**Definition:** Sum of USD-converted token amounts across all traded assets in qualifying trades.

**Computation:**
1. For each trade group with ≥2 distinct tokens:
2. For each asset activity in the group:
   - Extract `raw_amount` (on-chain decimal representation).
   - Fetch `decimals` from token registry (e.g., MOVEMENT = 8, USDC = 6).
   - Convert: `humanAmount = rawAmount / 10^decimals`.
   - Lookup USD price via `getTokenPriceUsd(assetAddress, priceMap)`.
   - Compute: `usdValue = humanAmount * priceUsd`.
3. Sum all USD values from the trade; if ≥$1 minimum, count as valid trade.
4. Return cumulative total.

**Anti-Gaming Rule:**
- Stablecoin price floor: If price lookup fails, default to $1.00 (e.g., USDC, USDT, USDa, USDe).
- Non-stablecoin missing price: Exclude from volume (0 contribution).
- Requires ≥$1 per trade to prevent microtransaction spam.
- Only outgoing transfers count (optional: filter by `is_transaction_success=true`).

**Example:**
```
Trade A:
  - 100 MOVEMENT @ $0.50 → $50
  - 200 USDC (price missing) → $0 (excluded, not stablecoin)
  Trade A Volume: $50 USD (qualifies, ≥$1)

Trade B:
  - 0.001 WETH @ $2000 → $2
  - 5 MOVEMENT @ $0.50 → $2.50
  Trade B Volume: $4.50 USD (qualifies)

Total: $50 + $4.50 = $54.50 USD
```

**Price Fallback Chain:**
1. CoinGecko API (via `useTokenPrices` hook, with 3-attempt retry).
2. Hardcoded stablecoin map (USDC, USDT, USDa, USDe → $1.00).
3. Token registry fallback (if token has `usdPrice` field).
4. Fail-safe: $0 (exclude from volume).

**Implementation:**
- See `getTokenPriceUsd()`, `parseRawAmount()`, `getTokenDecimalsForAsset()` in `eligibilityService.js`.
- Handles millisecond/second timestamp variance and malformed or missing decimals.

---

### 4. Token Diversity (`uniqueTokensTraded`)

**Definition:** Count of distinct asset types (unique coin types) the user has actively traded.

**Computation:**
1. For each trade group with ≥2 distinct tokens:
2. Extract canonical asset addresses (normalized, lowercase).
3. Add to Set<string> to deduplicate.
4. Return set cardinality.

**Anti-Gaming Rule:**
- Only assets in qualifying trades (min $1 volume) count.
- Canonical address must be resolvable from token registry or indexer data.

**Example:**
```
Trade 1: MOVEMENT (0x1::asset::MOVE), USDC (0xc::currency::USDC)
Trade 2: MOVEMENT (0x1::asset::MOVE), WETH (0xc::wrapped_token::WETH)
Trade 3: USDC (0xc::currency::USDC), WBTC (0xc::wrapped_token::WBTC)

Unique Tokens: {MOVEMENT, USDC, WETH, WBTC} → 4 tokens
```

**Implementation:**
- See `extractAssetAddress()` and `summarizeTradeGroups()` in `eligibilityService.js`.
- Normalizes addresses via `normalizeAddress()` (lowercased, 0x prefix stripped for comparison).

---

## Data Sources & Refresh Strategy

### Primary Source: Movement Network Indexer

**Endpoint:** `https://indexer.movementlabs.xyz/graphql` (or testnet equivalent)

**Query:** `getRecentTransactions(owner, limit=1000)`

**Response Fields:**
```graphql
{
  owner_address        # User's canonical address
  asset_type           # Full coin type (e.g., "0x1::asset::MOVE")
  activity_type        # "FUNGIBLE_ASSET_TRANSFER" or similar
  transaction_version  # Unique versioned transaction ID (for grouping)
  timestamp            # ISO 8601 string or milliseconds since epoch
  is_transaction_success # Boolean (filter for confirmed txns)
  amount              # Raw on-chain amount (before decimal conversion)
}
```

**Caching:**
- Client-side: Cache trades for 5 minutes (via React hook state + timestamp).
- Server-side (future): Cache metrics per user per day (via Redis with TTL=24h).
- Invalidation: Fresh query on user action (view badge, admin check) or 5-min elapsed.

### Secondary Source: Token Registry

**Location:** `config/tokens.js` (`MOVEMENT_TOKENS` constant)

**Fields per token:**
```javascript
{
  address: "0x1::asset::MOVE",
  symbol: "MOVE",
  decimals: 8,
  icon: "movement-logo.svg",
  // Optional:
  usdPrice: 0.50  // Fallback if CoinGecko fails
}
```

**Usage:**
- Resolve decimals: `getTokenDecimalsForAsset(address)`.
- Resolve symbol: `MOVEMENT_TOKENS.find(t => t.address === address)?.symbol`.
- Fallback price: Stablecoin hardcoded to $1.

### Tertiary Source: CoinGecko API

**Endpoint:** `https://api.coingecko.com/api/v3/simple/price?ids=movement-network,usd-coin,ethereum&vs_currencies=usd`

**Retry Logic:** 3 attempts, 1-second delay between retries (see `useTokenPrices` hook).

**Fallback:** If CoinGecko unavailable, use stablecoin defaults or registry fallback.

---

## On-Chain Badge Enforcement

### Contract: `contracts/swap_router/sources/badges.move`

**Badge Rules (3 types):**

1. **ALLOWLIST** (manual admin)
   - Admin maintains allowlist; user not self-attestable.
   - Use case: Community badges, OG user recognition.

2. **MIN_BALANCE** (on-chain coin balance)
   - User must hold ≥X of a coin type at mint time.
   - Use case: Hodler badges (hold 1000 MOVEMENT, etc.).

3. **OFFCHAIN_ALLOWLIST** (signed proof)
   - **This is where metrics live:**
   - Admin computes eligibility off-chain, signs allowlist snapshot with private key.
   - User submits proof (address + signature) to contract.
   - Contract verifies signature and mints SBT.
   - Anti-replay: Include `allowlist_version` or `expiration_timestamp` in signature data.

**Mint Flow:**
```
Admin (or Service):
  1. Query getEligibilityReport(userAddress)
  2. Evaluate: tradesCount ≥50 AND totalVolumeUsd ≥$1000 AND activeTradingDays ≥30
  3. If eligible, add to allowlist snapshot v42
  4. Sign snapshot hash (onchain-compatible move signature)

User (or Frontend):
  5. Fetch proof from Admin API (or Server)
  6. Call badges.move::mint_with_offchain_proof(proof, evidence)
  7. Contract verifies signature, adds badge to BadgeStore

Result:
  • Badge SBT minted and stored on-chain
  • No re-validation needed; signature = immutable proof
  • Prevents metagaming (can't mint badge for non-existent activity)
```

**Important:** 
- Do NOT store metric snapshots on-chain (too expensive, too rigid).
- Store only the **allowlist (user addresses) + signature** on-chain.
- Metrics computation remains off-chain and evolves independently.

---

## Implementation Roadmap

### Phase 1: Client-Side Metrics (✅ Complete)

**Deliverable:** `eligibilityService.getTradingMetrics(address)` function

**Components:**
- ✅ Helper functions: `normalizeAddress()`, `extractAssetAddress()`, `parseTimestampMs()`, `toUtcDayKey()`, `getTokenDecimalsForAsset()`, `getTokenPriceUsd()`.
- ✅ Grouping: `buildTradeGroups()`, `summarizeTradeGroups()`.
- ✅ Orchestrator: `getTradingMetrics()` returns `{tradesCount, activeTradingDays, uniqueTokensTraded, totalVolumeUsd, evaluatedActivities, evaluatedTrades}`.
- ✅ Eligibility checkers: `checkTradeCountEligibility()`, `checkActiveTradingDaysEligibility()`, `checkTradingVolumeEligibility()`, `checkTokenDiversityEligibility()`.
- ✅ Updated `getEligibilityReport()` to include all 4 metrics.

**Usage (Client):**
```javascript
const metrics = await getTradingMetrics(userAddress);
console.log(`${metrics.tradesCount} trades, $${metrics.totalVolumeUsd} volume`);

const report = await getEligibilityReport(userAddress);
// report.tradeCountEligible, report.volumeEligible, etc.
```

**Validation:** ✅ No syntax errors; function tested with mock data.

---

### Phase 2: UI Integration (🔄 In Progress)

**2a. Display Metrics in Badges.jsx**

Goal: Show user progress toward badge eligibility.

**Changes to `loadUserProgressStats` hook:**
```javascript
// Before:
const { txCount, daysOnchain } = await getEligibilityReport(address);

// After:
const { tradesCount, activeTradingDays, totalVolumeUsd, uniqueTokensTraded, ... } = 
  await getTradingMetrics(address);
```

**Display in Badge Card:**
```
🎯 VOLUME BADGE (2025 Season)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Progress:
  • Trades: 12/50 ✓ (24%)
  • Active Days: 7/30 ✓ (23%)
  • Volume: $340/$1000 USD (34%)
  • Token Diversity: 3/5 (60%)

Status: ⏳ In Progress
```

**2b. Display Metrics in Admin.jsx**

Goal: Enable admin audit of eligibility decisions.

**Changes to `handleCheckEligibility` form:**
```javascript
// After user submits address:
const report = await getEligibilityReport(userAddress);

// Display checklist:
✓ Trades: 52/50 (ELIGIBLE)
✓ Volume: $1250/$1000 (ELIGIBLE)
✓ Active Days: 28/30 (IN PROGRESS)
✗ Token Diversity: 2/5 (INELIGIBLE)

→ Overall: INELIGIBLE (not all criteria met)
```

---

### Phase 3: Server-Side Migration (⏳ Future)

Goal: Move metric computation and allowlist signing to backend service.

**Deliverable:** Node.js service that:
1. Polls indexer every 6 hours.
2. Computes metrics for all active users.
3. Evaluates eligibility against badge tier rules.
4. Generates JSON allowlist + ECDSA signature.
5. Exposes API endpoint: `GET /api/badges/allowlist?version=42` → signed snapshot.

**Code Reuse:**
- Port `getTradingMetrics()` logic from `eligibilityService.js` to TypeScript/Node.js.
- Use same indexer query structure (GraphQL endpoint).
- Reuse token registry and stablecoin price logic.
- Keep anti-gaming rules identical (no divergence between client and server).

**Example Node.js Port:**
```typescript
// backend/services/badgeEligibility.ts

interface TradeMetrics {
  tradesCount: number;
  activeTradingDays: number;
  uniqueTokensTraded: number;
  totalVolumeUsd: number;
}

async function getTradingMetrics(userAddress: string): Promise<TradeMetrics> {
  const activities = await indexer.getRecentTransactions(userAddress);
  const tradeGroups = buildTradeGroups(activities);
  const priceMap = await fetchPricesFromCoinGecko();
  const summary = summarizeTradeGroups(tradeGroups, priceMap);
  return {
    tradesCount: summary.trades.length,
    activeTradingDays: new Set(summary.trades.map(t => toUtcDayKey(t.timestamp))).size,
    uniqueTokensTraded: new Set(summary.trades.flatMap(t => t.assets.map(a => extractAssetAddress(a)))).size,
    totalVolumeUsd: summary.trades.reduce((sum, t) => sum + t.usdVolume, 0)
  };
}

async function generateAllowlist(badgeTierId: number): Promise<AllowlistSnapshot> {
  const tier = BADGE_TIER_RULES[badgeTierId];
  const allUsers = await db.getAllUsers();
  const eligible = [];

  for (const user of allUsers) {
    const metrics = await getTradingMetrics(user.address);
    if (checkEligibility(metrics, tier.thresholds)) {
      eligible.push(user.address);
    }
  }

  const snapshot = {
    version: getCurrentVersion(),
    badgeTierId,
    eligibleAddresses: eligible,
    timestamp: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24h TTL
  };

  const signature = signSnapshot(snapshot, getPrivateKey());
  return { snapshot, signature };
}
```

**API Usage (Client):**
```javascript
// Before: client computes metrics
const metrics = await getTradingMetrics(userAddress);

// After: server provides signed proof
const proof = await fetch('/api/badges/allowlist?userId=0x123&tierId=1');
// proof = { snapshot, signature }

// Client submits directly to contract
tx = await badges.mint_with_offchain_proof(proof.snapshot, proof.signature);
```

**Benefits:**
- Eliminates client-side metric computation (faster, more reliable).
- Server can batch compute for all users (efficient).
- Signature proves allowlist was generated by trusted admin (immutable).
- Client never needs to know implementation details (metric definitions can evolve server-side).

---

## Anti-Gaming & Security

### Trade Legitimacy

**Filters:**
- ✅ Transaction must succeed: `is_transaction_success = true`.
- ✅ Trade must involve ≥2 distinct coin types (no self-transfer).
- ✅ Trade must have minimum volume: $1 USD equivalent.
- ✅ No smart contract creation transfers (only fungible assets).

**Reasoning:**
- Self-transfers (MOVE → MOVE) don't prove trading intent.
- Dust trades ($0.001 volumes) are trivial to spam.
- Failed transactions are not economic activity.

### Timestamp Validation

**Rules:**
- Timestamp must be within last 365 days (no historical lookback > 1 year).
- Timestamp must be ≤ current wallclock time (no future dates).
- Active days counted in UTC calendar (timezone-agnostic).

### Price Accuracy

**Rules:**
- CoinGecko prices sourced every 5 minutes (client) or 6 hours (server).
- Stablecoin prices hardcoded to $1.00 (no variance).
- Missing prices excluded from volume (conservative).
- No synthetic/derivative prices; reject any non-CoinGecko source.

### Replay Prevention (On-Chain)

**For OFFCHAIN_ALLOWLIST badges:**
```move
// Pseudo-code: badges.move
resource AllowlistSnapshot {
  version: u64,        // Global counter, increments per regeneration
  badgeTierId: u64,    // Which badge
  eligibleAddresses: vector<address>,
  expiration: u64,     // 24h from generation
  signature: vector<u8> // Admin's ECDSA sig over {version, badgeTierId, timestamp}
}

public entry fun mint_with_offchain_proof(
  owner: &signer,
  snapshot: AllowlistSnapshot,
  signature: vector<u8>
) {
  // 1. Verify signature matches (ECDSA pub key = admin)
  assert!(verify_signature(snapshot_hash(snapshot), signature, ADMIN_PUBKEY), ERR_BAD_SIG);
  
  // 2. Verify owner in allowlist
  assert!(vector::contains(&snapshot.eligibleAddresses, &signer::address_of(owner)), ERR_NOT_ELIGIBLE);
  
  // 3. Verify not expired (optional: for safety)
  assert!(timestamp::now_seconds() <= snapshot.expiration, ERR_EXPIRED);
  
  // 4. Mint badge
  let badge = BadgeSBT { ... };
  move_to(owner, badge);
  
  // 5. Emit event (for indexing/audit)
  event::emit(BadgeMinted { owner: signer::address_of(owner), tierId: snapshot.badgeTierId });
}
```

**Anti-Replay:** 
- Allowlist version/timestamp in signature prevents old snapshots from being replayed.
- Expiration timestamp (24h TTL) ensures stale allowlists rejected even if not versioned.
- Smart contract stores minted badges, so user can't mint same badge twice (state check).

---

## Monitoring & Debugging

### Metric Audit Trail

**Log structure (on eligibility check):**
```json
{
  "timestamp": "2025-01-20T15:30:00Z",
  "userAddress": "0x123",
  "metrics": {
    "tradesCount": 52,
    "activeTradingDays": 28,
    "uniqueTokensTraded": 4,
    "totalVolumeUsd": 1250.50,
    "evaluatedTrades": [
      {
        "timestamp": "2025-01-15T10:30:00Z",
        "utcDayKey": "2025-01-15",
        "assets": ["0x1::asset::MOVE", "0xc::currency::USDC"],
        "usdVolume": 50.25
      }
    ]
  },
  "eligibilityChecks": {
    "tradeCountEligible": { "eligible": true, "current": 52, "required": 50 },
    "volumeEligible": { "eligible": true, "current": 1250.50, "required": 1000 },
    "activeDaysEligible": { "eligible": false, "current": 28, "required": 30 },
    "tokenDiversityEligible": { "eligible": true, "current": 4, "required": 3 }
  },
  "overallEligible": false  // Not all criteria met
}
```

**Admin Tools:**
- CLI: `node scripts/checkEligibility.js <userAddress>` → outputs full audit trail.
- Dashboard: Admin.jsx form with "Show Audit Trail" button → dumps JSON.

### Common Issues & Resolutions

| Issue | Cause | Resolution |
|-------|-------|-----------|
| "0 trades detected" | No fungible activities in indexer | Check if user has actually swapped; indexer may have lag (5-10 min) |
| "Volume $0 USD" | All token prices missing | Verify CoinGecko API is reachable; check stablecoin price fallback |
| "Timestamp parsing error" | Indexer returns non-ISO format | Update `parseTimestampMs()` to handle additional formats; add test case |
| "Active days = 1" | All trades on same day | Expected if user is a day-trader; check trade count to verify active |
| "Duplicate trades counted" | `buildTradeGroups()` grouping bug | Verify transaction_version field populated in indexer query; check fallback logic |

---

## Configuration & Thresholds

### Badge Tier Definition Example

**File:** `config/badges.js`

```javascript
export const BADGE_TIER_RULES = {
  // VOLUME badges
  VOLUME_SILVER: {
    metricType: "TRADING_VOLUME",
    threshold: 500,    // $500 USD
    season: 2025,
    rarity: "COMMON"
  },
  VOLUME_GOLD: {
    metricType: "TRADING_VOLUME",
    threshold: 2000,   // $2000 USD
    season: 2025,
    rarity: "RARE"
  },
  VOLUME_PLATINUM: {
    metricType: "TRADING_VOLUME",
    threshold: 5000,   // $5000 USD
    season: 2025,
    rarity: "EPIC"
  },
  
  // ACTIVE DAYS badges
  ACTIVE_TRADER_7: {
    metricType: "ACTIVE_TRADING_DAYS",
    threshold: 7,      // 7 distinct days
    season: 2025,
    rarity: "COMMON"
  },
  ACTIVE_TRADER_30: {
    metricType: "ACTIVE_TRADING_DAYS",
    threshold: 30,     // 30 distinct days
    season: 2025,
    rarity: "EPIC"
  },
  
  // TRADE COUNT badges
  SWAPPER_50: {
    metricType: "TRADE_COUNT",
    threshold: 50,     // 50 trades
    season: 2025,
    rarity: "COMMON"
  },
  
  // TOKEN DIVERSITY badges
  EXPLORER_5: {
    metricType: "UNIQUE_TOKENS",
    threshold: 5,      // 5+ distinct tokens
    season: 2025,
    rarity: "RARE"
  }
};

export const BADGE_TIERS = [
  {
    id: 1,
    name: "Volume Trader",
    description: "Trade $500+ USD on Movement Network",
    rule: "VOLUME_SILVER",
    icon: "volume-trader.svg",
    rarity: "COMMON"
  },
  // ... more tiers
];
```

### Constants

**File:** `config/constants.js` (add/update)

```javascript
export const MIN_VOLUME_PER_TRADE = 1;           // USD
export const TRADE_GROUPING_WINDOW_MS = 60000;  // 1 minute (for fallback)
export const METRICS_CACHE_TTL_MS = 300000;     // 5 minutes
export const INDEXER_QUERY_LIMIT = 1000;        // Max activities to fetch
export const ACTIVE_DAYS_LOOKBACK_DAYS = 365;   // 1 year max
export const STABLECOIN_PRICE_FIXED = 1.00;     // USD
export const COINGECKO_RETRY_ATTEMPTS = 3;
export const COINGECKO_RETRY_DELAY_MS = 1000;
```

---

## Future Enhancements

1. **Composable Metrics:** Allow mixing metrics (e.g., "Volume AND ActiveDays" vs. "Volume OR TokenDiversity").
2. **Time-Window Badges:** "Volume in last 7 days" vs. "all-time volume".
3. **Seasonal Reset:** Clear metrics at season boundary, regenerate allowlists.
4. **Leaderboards:** Rank users by metric (top 100 traders by volume).
5. **Metric Webhooks:** Notify user when they qualify for badge (push notification, in-app toast).
6. **Historical Audits:** Archive metric snapshots per user per day (for season retrospectives).

---

## References

- **Indexer Query:** [services/indexer.js](services/indexer.js#L45) (`getRecentTransactions`)
- **Metrics Computation:** [services/eligibilityService.js](services/eligibilityService.js) (`getTradingMetrics`, 4 eligibility checkers)
- **Badge Contract:** [contracts/swap_router/sources/badges.move](contracts/swap_router/sources/badges.move) (OFFCHAIN_ALLOWLIST rule)
- **UI Integration:** [pages/Badges.jsx](pages/Badges.jsx) (loadUserProgressStats), [pages/Admin.jsx](pages/Admin.jsx) (handleCheckEligibility)
- **Config:** [config/badges.js](config/badges.js), [config/tokens.js](config/tokens.js), [config/constants.js](config/constants.js)

---

**Version:** 1.0  
**Author:** Movement Network Portfolio Manager  
**Last Updated:** 2025-01-20  
**Status:** Production-Ready (Phase 1 Complete, Phase 2-3 In Progress)
