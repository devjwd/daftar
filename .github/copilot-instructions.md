# Movement Network Portfolio Manager - AI Coding Instructions

## Big Picture
- React/Vite app in frontend/: `App.jsx` orchestrates wallet connect, address search, data fetch, and UI.
- Data flow: Indexer GraphQL first via `useIndexerBalances` → fallback to RPC resources → `useDeFiPositions` scans resources → `useTokenPrices` adds USD → UI renders skeletons then animated cards.
- External deps: Movement RPC + Indexer, CoinGecko prices, Aptos wallet adapters.

## Critical Patterns (read before edits)
- Address normalization is required for both RPC and Indexer; wallet adapters may return AccountAddress objects. See `App.jsx` fetch flow and `utils/tokenUtils.js`.
- Dual-source balances: indexer returns empty on errors to trigger RPC fallback (see `services/indexer.js`, `hooks/useIndexerBalances.js`).
- DeFi adapters: each file in `config/adapters/` exports an array of position definitions with `searchString` and `parse(data)`.
- MUST add new adapters to `config/adapters/index.js` `ALL_ADAPTERS` or `useDeFiPositions` will fail at runtime.
- Movement defaults to 8 decimals; USDC/USDT use 6 (see `config/tokens.js`, `config/constants.js`). Use `parseCoinType()` and `isValidAddress()`.

## UI/UX Conventions
- Premium glassmorphism in `App.css`; skeleton loaders + shimmer in `App.jsx` (`SkeletonCard`).
- Animation delays come from `config/constants.js` (`ANIMATION_DELAYS`).
- Components are functional; use `useMemo` for Aptos client and adapter lists, `useCallback` for async handlers.

## Developer Workflow (from frontend/)
- `npm run dev` (Vite dev server), `npm run build`, `npm run preview`, `npm run lint`.
- Optional `.env`: `VITE_NETWORK=mainnet|testnet` (see `config/network.js`).

## Integration Notes
- Indexer endpoints in `services/indexer.js` (case-sensitive owner addresses; always lowercase).
- CoinGecko retries are built into `useTokenPrices.js` (3 attempts, delay between tries).
- Swap is demo-only (`components/Swap.jsx`) and uses price-based calculation, not DEX quotes.

## Example Change Hotspots
- New protocol: create adapter in `config/adapters/` + register in `config/adapters/index.js`.
- Token registry updates: `config/tokens.js` and decimals in `config/constants.js`.
