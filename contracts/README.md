# Movement Network Contracts

Smart contracts for the Movement Network Portfolio Manager.

## Contracts

### 📊 Swap Router (`swap_router/`)

A Move smart contract that enables token swaps with fee collection through multiple DEX aggregators.

**Features:**
- Multi-router support (Mosaic & Yuzu)
- Configurable fee collection (0.01% - 10%)
- Admin fee management
- Event tracking and auditing

**Status:** ✅ Ready for deployment

**Quick Start:**
```bash
cd swap_router
movement move compile --named-addresses swap_router=default
movement move test
movement move publish --named-addresses swap_router=default
```

See [swap_router/README.md](swap_router/README.md) for detailed documentation.

## Directory Structure

```
contracts/
└── swap_router/
    ├── Move.toml           # Package manifest
    ├── README.md           # Contract documentation
    └── sources/
        └── router.move     # Main router module
```

## Development Workflow

### 1. Prerequisites

Install Movement CLI:
```bash
# Visit: https://docs.movementnetwork.xyz/devs/movementcli
```

Initialize your account:
```bash
movement init --network custom \
  --rest-url https://testnet.movementnetwork.xyz/v1 \
  --faucet-url https://faucet.testnet.movementnetwork.xyz/
```

### 2. Compile

```bash
cd swap_router
movement move compile --named-addresses swap_router=default
```

### 3. Test

```bash
movement move test
```

### 4. Deploy

**Testnet:**
```bash
movement move publish \
  --named-addresses swap_router=default \
  --network testnet
```

**Mainnet:**
```bash
movement move publish \
  --named-addresses swap_router=YOUR_MAINNET_ADDRESS \
  --network mainnet
```

## Contract Addresses

### Testnet
- **Swap Router**: Deploy and update here

### Mainnet  
- **Swap Router**: Deploy and update here

## Integration

After deploying contracts, update the frontend configuration:

```javascript
// frontend/src/config/network.js
export const SWAP_ROUTER_ADDRESS = "0xYOUR_DEPLOYED_ADDRESS";
```

See [../SWAP_INTEGRATION.md](../SWAP_INTEGRATION.md) for complete integration guide.

## Testing

Run all contract tests:
```bash
cd swap_router && movement move test
```

Expected output:
```
Running Move unit tests
[ PASS    ] swap_router::router::test_initialize
[ PASS    ] swap_router::router::test_initialize_invalid_fee
Test result: OK. Total tests: 2; passed: 2; failed: 0
```

## Security

### Best Practices
- Always test on testnet first
- Audit contracts before mainnet deployment
- Use hardware wallets for admin operations
- Monitor contract events for suspicious activity

### Fee Limits
- Minimum: 1 bps (0.01%)
- Maximum: 1000 bps (10%)
- Recommended: 30 bps (0.3%)

## Resources

### Movement Network
- [Developer Docs](https://docs.movementnetwork.xyz/devs)
- [Movement CLI](https://docs.movementnetwork.xyz/devs/movementcli)
- [Move Book](https://docs.movementnetwork.xyz/devs/move-book)
- [Network Endpoints](https://docs.movementnetwork.xyz/devs/networkEndpoints)

### DEX Documentation
- [Mosaic](https://docs.mosaic.ag/)
- [Yuzu](https://docs.yuzu.finance/)

### Tools
- [Faucet](https://faucet.movementnetwork.xyz/)
- [Explorer](https://explorer.movementnetwork.xyz/)

## Contributing

When adding new contracts:
1. Create a new directory under `contracts/`
2. Include `Move.toml` manifest
3. Add comprehensive `README.md`
4. Write unit tests
5. Document deployment steps
6. Update this README

## License

MIT - see [LICENSE](../LICENSE)
