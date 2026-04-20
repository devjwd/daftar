# Swap Router Contract

A Move smart contract for fee collection and swap analytics around Mosaic execution on the Movement Network.

## Overview

This contract provides:
- **Mosaic source guard**: Fee collection is restricted to Mosaic source ID
- **Fee collection**: Configurable fee in basis points (0% - 5%)
- **Admin controls**: Update fees and treasury address
- **Event tracking**: Monitor all fee collections and swap metadata

## Contract Structure

```
swap_router/
├── Move.toml           # Package manifest
└── sources/
    └── router.move     # Main router logic
```

## Features

### Fee Management
- Configurable fee from 0% to 5% (0-500 basis points)
- Admin-only fee updates
- Dedicated fee treasury
- Real-time fee calculation

### Execution Model
- Frontend requests quote + tx payload from Mosaic API
- Frontend can call `collect_fee` before aggregator execution
- Aggregator swap executes in a separate transaction
- Events are emitted for on-chain analytics

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

### Collect Fee (Mosaic source)

```typescript
const payload = {
  function: `${CONTRACT_ADDRESS}::router::collect_fee`,
  typeArguments: [
    "0x1::aptos_coin::AptosCoin",           // CoinIn
  ],
  functionArguments: [
    100000000,  // amount_in (1 MOVE with 8 decimals)
    1,          // router_source (1 = mosaic)
  ],
};
```

### View Functions

```typescript
// Get config
const [feeBps, treasury, totalCollected, totalSwaps, paused] = await aptos.view({
  function: `${CONTRACT_ADDRESS}::router::get_config`,
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
  function: `${SWAP_ROUTER_ADDRESS}::router::collect_fee`,
  // ...
};
```

## Error Codes

- `E_NOT_ADMIN (100)`: Caller is not the admin
- `E_NOT_PENDING_ADMIN (101)`: Caller is not pending admin
- `E_INVALID_ADMIN (102)`: Invalid admin input
- `E_INVALID_FEE (200)`: Fee exceeds 5%
- `E_ZERO_AMOUNT (201)`: Input amount is zero
- `E_UNSUPPORTED_ROUTER_SOURCE (204)`: Unsupported source ID
- `E_INVALID_TREASURY (205)`: Treasury is zero address
- `E_PAUSED (300)`: Router is paused
- `E_ALREADY_INITIALIZED (301)`: Router already initialized
- `E_NOT_INITIALIZED (302)`: Router not initialized

## Fee Structure

- Minimum: 0% (0 bps)
- Maximum: 5% (500 bps)
- Recommended: 0.3% (30 bps) for competitive rates

## Security

- Admin-only functions protected
- Fee capped at 5%
- Event tracking for auditing

## Production Notes

**Current Implementation**: The contract currently acts as a fee wrapper. For production:

1. The current contract does not execute the swap itself; it only collects protocol fee and emits events.
2. Aggregator execution is handled by Mosaic tx payloads produced off-chain.
3. If atomic execution is required, compose fee collection + swap into a single on-chain flow.
4. Keep frontend payload validation strict to trusted contract/module targets.

## License

MIT

## Support

For questions or issues:
- Movement Docs: https://docs.movementnetwork.xyz/
- Mosaic Docs: https://docs.mosaic.ag/
- Yuzu Docs: https://docs.yuzu.finance/
