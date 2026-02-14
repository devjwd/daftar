# Swap Router Contract

A Move smart contract for routing token swaps through multiple DEX aggregators (Mosaic and Yuzu) with fee collection on the Movement Network.

## Overview

This contract provides:
- **Multi-router support**: Route swaps through Mosaic or Yuzu
- **Fee collection**: Configurable fee in basis points (0.01% - 10%)
- **Admin controls**: Update fees and treasury address
- **Event tracking**: Monitor all swaps and fees collected

## Contract Structure

```
swap_router/
├── Move.toml           # Package manifest
└── sources/
    └── router.move     # Main router logic
```

##Features

### Fee Management
- Configurable fee from 0.01% to 10% (1-1000 basis points)
- Admin-only fee updates
- Dedicated fee treasury
- Real-time fee calculation

### Router Integration
- **Mosaic**: DEX aggregator for best price execution
- **Yuzu**: CLMM (Concentrated Liquidity Market Maker)
- Automatic fee deduction before routing
- Event emission for tracking

## Deployment

### Prerequisites
1. Install Movement CLI:
   ```bash
   # Follow: https://docs.movementnetwork.xyz/devs/movementcli
   ```

2. Initialize your account:
   ```bash
   movement init --network custom \
     --rest-url https://testnet.movementnetwork.xyz/v1 \
     --faucet-url https://faucet.testnet.movementnetwork.xyz/
   ```

3. Fund your account from the [Movement Faucet](https://faucet.movementnetwork.xyz/)

### Compile

```bash
cd contracts/swap_router
movement move compile --named-addresses swap_router=default
```

### Test

```bash
movement move test
```

### Publish

```bash
movement move publish --named-addresses swap_router=default
```

After deployment, note your contract address for frontend integration.

## Usage

### Initialize Router

```typescript
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const aptos = new Aptos(
  new AptosConfig({ 
    network: Network.CUSTOM,
   fullnode: "https://testnet.movementnetwork.xyz/v1"
  })
);

// Initialize with 0.3% fee (30 basis points)
const payload = {
  function: `${YOUR_CONTRACT_ADDRESS}::router::initialize`,
  typeArguments: [],
  functionArguments: [
    30,                    // fee in bps
    YOUR_TREASURY_ADDRESS  // fee treasury
  ],
};

await signAndSubmitTransaction({ data: payload });
```

### Swap via Mosaic

```typescript
const payload = {
  function: `${CONTRACT_ADDRESS}::router::swap_via_mosaic`,
  typeArguments: [
    "0x1::aptos_coin::AptosCoin",           // CoinIn
    "0xf22...::asset::USDC"                 // CoinOut
  ],
  functionArguments: [
    100000000,  // amount_in (1 MOVE with 8 decimals)
    99000000,   // amount_out_min (considering slippage)
  ],
};
```

### Swap via Yuzu

```typescript
const payload = {
  function: `${CONTRACT_ADDRESS}::router::swap_via_yuzu`,
  typeArguments: [
    "0x1::aptos_coin::AptosCoin",
    "0xf22...::asset::USDC"
  ],
  functionArguments: [
    100000000,  // amount_in
    99000000,   // amount_out_min
    2500,       // fee_tier (0.25% pool)
  ],
};
```

### View Functions

```typescript
// Get fee configuration
const [feeBps, treasury, totalCollected] = await aptos.view({
  function: `${CONTRACT_ADDRESS}::router::get_fee_config`,
  typeArguments: [],
  functionArguments: [],
});

// Calculate fee for specific amount
const [feeAmount] = await aptos.view({
  function: `${CONTRACT_ADDRESS}::router::calculate_fee`,
  typeArguments: [],
  functionArguments: [100000000], // amount to swap
});
```

## Admin Functions

### Update Fee

```typescript
const payload = {
  function: `${CONTRACT_ADDRESS}::router::update_fee`,
  typeArguments: [],
  functionArguments: [50], // new fee in bps (0.5%)
};
```

### Update Treasury

```typescript
const payload = {
  function: `${CONTRACT_ADDRESS}::router::update_treasury`,
  typeArguments: [],
  functionArguments: [NEW_TREASURY_ADDRESS],
};
```

## Integration with Frontend

Add the contract address to your frontend configuration:

```javascript
// frontend/src/config/network.js
export const SWAP_ROUTER_ADDRESS = "YOUR_DEPLOYED_CONTRACT_ADDRESS";

// frontend/src/components/Swap.jsx
import { SWAP_ROUTER_ADDRESS } from "../config/network";

// Use in transaction payload
const payload = {
  function: `${SWAP_ROUTER_ADDRESS}::router::swap_via_mosaic`,
  // ...
};
```

## Error Codes

- `E_NOT_ADMIN (1)`: Caller is not the admin
- `E_INVALID_FEE (2)`: Fee exceeds 10%
- `E_ZERO_AMOUNT (3)`: Swap amount is zero
- `E_SLIPPAGE_EXCEEDED (4)`: Output less than minimum
- `E_INVALID_ROUTER (5)`: Unknown router type

## Fee Structure

- Minimum: 0.01% (1 bps)
- Maximum: 10% (1000 bps)
- Recommended: 0.3% (30 bps) for competitive rates

## Security

- Admin-only functions protected
- Fee capped at 10%
- Slippage protection
- Event tracking for auditing

## Production Notes

**Current Implementation**: The contract currently acts as a fee wrapper. For production:

1. **Mosaic Integration**: Call the actual Mosaic router contract (`0xede23ef215f0594e658b148c2a391b1523335ab01495d8637e076ec510c6ec3c::router::swap`)
2. **Yuzu Integration**: Call Yuzu's router (`yuzuswap::router::swap_exact_coin_for_coin`)
3. **Add slippage checks**: Verify `amount_out >= amount_out_min`
4. **Handle multi-hop swaps**: Support routing through multiple pools

## License

MIT

## Support

For questions or issues:
- Movement Docs: https://docs.movementnetwork.xyz/
- Mosaic Docs: https://docs.mosaic.ag/
- Yuzu Docs: https://docs.yuzu.finance/
