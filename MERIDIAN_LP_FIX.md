# Meridian LP Position Tracking Fix

## Problem Analysis
Meridian LP positions were not showing in the portfolio manager because:

1. **Phase 1 Resource Filtering**: LP coins stored in `0x1::coin::CoinStore<...LPCoin>` were being skipped entirely before reaching adapter matching
2. **Wrong Decimal Calculation**: If processed as receipt tokens, would use 8 decimals instead of 6, resulting in 100x undercount
3. **Adapter Pattern Limitation**: Original search pattern was too generic and didn't match LP coin formats reliably

## Changes Made

### 1. **src/config/adapters/meridian.js** - Enhanced LP Detection
- Added specific search pattern for Meridian contract address:
  - Primary: `0x8f396e4246b2ba87b51c0739ef5ea4f26480d2cf4e42c4ca7e86e98f1d5e3d82::swap::LPCoin`
  - Fallback: `::swap::LPCoin<` for generic LP coins
  
- Enhanced parse() function with:
  - Multiple field extraction strategies (coin.value, value, amount, nested recursion)
  - Smart decimal handling (tries 6 decimals first, falls back to 8)
  - Better error handling for edge cases

### 2. **src/hooks/useDeFiPositions.js** - Fixed Resource Processing Flow

#### Phase 1:
- Modified CoinStore resource handling to detect LP coins early
- Added regex: `/::swap::LPCoin|::amm::|::pool::|LPCoin|LPToken/i`
- LP coins now **bypass** receipt token processing
- LP coins continue to Phase 1.75 adapter matching (correct flow)

#### Phase 1.75:
- Added debug logging for Meridian LP detection
- Logs include: resource type, parsed value, data structure
- Better error messages for troubleshooting

### 3. **Added Debug Logging**
When in development mode, console logs show:
- LP-like resources detected
- Meridian adapter matching
- Parsed values and data structure
- Skip reasons (dust, parsing errors, etc.)

## How It Works Now

### Resource Flow for Meridian LP:
```
User has LP token in wallet
        ↓
RPC fetches all account resources
        ↓
Phase 1: LP in CoinStore detected via /LPCoin/i pattern
        ↓
Bypasses receipt token processing (no wrong decimals!)
        ↓
Phase 1.75: Adapter matching begins
        ↓
Meridian adapter searchString matches
        ↓
Parse function extracts value with proper 6-decimal handling
        ↓
Value > 0.0001? → Added to positions ✓
        ↓
Display in UI with correct amount and pool info
```

## Testing Recommendations

1. **Check Console Logs** (DevTools - F12):
   - Look for "🔍 Found LP-like resource" messages
   - Look for "🔷 Meridian LP adapter matched" messages
   - Verify parsed values are reasonable

2. **Test Transactions**:
   - Add liquidity via https://app.meridian.money/
   - Position should appear in 2-3 seconds
   - Check USDC/USDT and USDC/USDE pools

3. **Verify Values**:
   - Check amount matches pool tokens
   - Values should not be 100x too small or large
   - Dust amounts (<0.0001) are properly filtered

## Supported Meridian Pool Types

✅ USDC/USDT  
✅ USDC/USDE  
✅ Any ERC-20 compatible token pairs on Meridian  

## Future Improvements

- [ ] Add pool composition display (X token + Y token breakdown)
- [ ] Add Meridian staking pool detection
- [ ] Add yield/APY information from Meridian API
- [ ] Support LP position creation tracking via transactions

## Files Modified

1. `src/config/adapters/meridian.js` - Adapter logic
2. `src/hooks/useDeFiPositions.js` - Resource detection and processing
