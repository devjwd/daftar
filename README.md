# Movement Network Portfolio Manager

A comprehensive DeFi portfolio manager and swap interface for the Movement Network ecosystem.

## 🌟 Features

### 📊 Portfolio Management
- **Real-time Balance Tracking**: View all your token balances across Movement Network
- **DeFi Position Detection**: Automatically detect lending, staking, and LP positions
- **USD Valuation**: Live pricing from CoinGecko
- **Multi-Protocol Support**: Echelon, LayerBank, Meridian, Yuzu, Canopy, and more
- **NFT Detection**: Track your Yuzu liquidity position NFTs

### 💱 Token Swapping
- **Multi-Router Support**: Choose between Mosaic (aggregator) and Yuzu (CLMM)
- **Best Price Execution**: Mosaic finds optimal routes across all DEXs
- **Real-time Quotes**: Live pricing with 500ms updates
- **Slippage Protection**: Configurable tolerance (0.1% - 50%)
- **Fee Collection**: Smart contract-based fee management
- **Route Visualization**: See the path your trade takes

### 🎨 Professional UI
- **Glassmorphism Design**: Modern, premium interface
- **Responsive Layout**: Works on desktop and mobile
- **Dark Mode**: Easy on the eyes
- **Smooth Animations**: Polished user experience
- **Wallet Integration**: Petra and OKX wallet support

## 🚀 Quick Start

**5-Minute Setup:**
```bash
# 1. Deploy contract
cd contracts/swap_router
./deploy.sh testnet

# 2. Initialize contract
movement move run --function-id '<address>::router::initialize' \
  --args u64:30 --args address:'<treasury>'

# 3. Run frontend
cd ../../frontend
npm install
npm run dev
```

See [QUICKSTART.md](QUICKSTART.md) for detailed steps.

## 📁 Project Structure

```
Movement Portfolio Manager/
├── contracts/               # Move smart contracts
│   └── swap_router/        # Swap fee collection contract
│       ├── sources/
│       │   └── router.move # Main contract
│       ├── Move.toml       # Package manifest
│       ├── deploy.sh       # Deployment script
│       └── README.md       # Contract docs
│
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   │   ├── Swap.jsx   # Swap interface
│   │   │   ├── Layout.jsx # App layout
│   │   │   └── ...
│   │   ├── config/        # Configuration
│   │   │   ├── network.js # Network settings
│   │   │   ├── tokens.js  # Token registry
│   │   │   └── adapters/  # DeFi protocols
│   │   ├── hooks/         # React hooks
│   │   ├── services/      # API services
│   │   └── pages/         # Route pages
│   ├── package.json
│   └── vite.config.js
│
└── docs/                   # Documentation
    ├── QUICKSTART.md      # 5-minute setup
    ├── SWAP_INTEGRATION.md # Complete guide
    ├── SWAP_SUMMARY.md    # Implementation summary
    └── README.md          # This file
```

## 🪙 Badge & Achievement System

A new subsystem to reward on‑chain activity, longevity, and balances using customizable badges. The frontend and toolchain include:

- `frontend/src/config/badges.js` – badge definitions, rarity, XP values, and rule identifiers.
- `frontend/src/services/badgeService.js` – helpers for on‑chain badge metadata and transaction builders.
- `frontend/src/services/badgeApi.js` – optional client for a backend that persists awarded badges.
- `frontend/src/services/badgeAdapters/` – pluggable eligibility rules (transaction count, longevity, min balance).
- Hooks: `useBadges`, `useUserBadges` load on‑chain and backend badges for the UI.
- UI changes: updated profile modal, global footer, badges grid.

### Running the Badge Worker

If you host a backend, you can periodically evaluate addresses against your badge configuration and call the award API. A simple Node script lives in `scripts/badgeEligibilityRunner.js`:

```bash
# check a single address (prints candidates)
node scripts/badgeEligibilityRunner.js 0xabc123

# use a config file and actually POST awards to your server
node scripts/badgeEligibilityRunner.js 0xabc123 --config=scripts/badgeConfigs.json --award
```

The script loads adapter rules from `badgeAdapters` and can be expanded to read your badgeConfig from a database or schedule via cron/worker process.
\
### Optional Backend Service
\
For a full production setup you can deploy a simple Node/Express service that
persists awarded badges and runs the scanning worker automatically. The
repository includes a minimal implementation under `server/`.
\
```bash
# install dependencies at project root
npm install
\
# start service (runs Express API and hourly scan)
npm run start
\
# manually trigger worker scan
curl http://localhost:4000/api/badges/scan
\
# add an address to be tracked (worker will evaluate it each hour)
curl -X POST http://localhost:4000/api/badges/track \
  -H "Content-Type: application/json" \
  -d '{"address":"0xabc..."}'
```
\
The backend exposes the same endpoints consumed by the frontend's
`badgeApi.js` client (`/api/badges`, `/api/badges/user/:address`,
`/api/badges/award`).  The backend uses Supabase (PostgreSQL) for persistent storage
of badge awards and tracked addresses.

## 🛠️ Technology Stack

### Smart Contracts
- **Language**: Move
- **Framework**: Aptos Framework
- **Network**: Movement Network (Aptos-compatible)

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Wallet**: Aptos Wallet Adapter
- **SDK**: Aptos TypeScript SDK
- **Styling**: CSS Modules (Glassmorphism)

### APIs & Services
- **Mosaic**: DEX aggregator API
- **Movement Indexer**: GraphQL balance queries
- **CoinGecko**: Token pricing
- **Supabase**: PostgreSQL database for profiles, badges and leaderboard

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | Get started in 5 minutes |
| [SWAP_INTEGRATION.md](SWAP_INTEGRATION.md) | Complete integration guide |
| [SWAP_SUMMARY.md](SWAP_SUMMARY.md) | Implementation overview |
| [contracts/README.md](contracts/README.md) | Contract documentation |
| [frontend/README.md](frontend/README.md) | Frontend documentation |

## 🎯 Supported Protocols

### DEXs
- ✅ **Mosaic** - DEX aggregator
- ✅ **Yuzu** - Concentrated liquidity (CLMM)
- 🟡 **Razor** - AMM (coming soon)
- 🟡 **Meridian** - AMM (coming soon)

### Lending
- ✅ **Echelon Market** - Money market
- ✅ **LayerBank** - Lending protocol

### Staking
- ✅ **Canopy Finance** - Liquid staking
- ✅ **MovePosition** - Position management

### Others
- ✅ **Joule** - DeFi aggregator
- 🟡 More protocols coming...

## 🔐 Security

### Smart Contract
- Fee limit: 10% maximum
- Admin-only controls
- Event tracking for audits
- Comprehensive tests

### Frontend
- Input validation
- Slippage protection
- Transaction confirmation
- Error handling

## 🎨 Screenshots

### Portfolio View
![Portfolio](docs/images/portfolio.png)

### Swap Interface
![Swap](docs/images/swap.png)

### DeFi Positions
![DeFi](docs/images/defi.png)

## 🧪 Testing

### Contract Tests
```bash
cd contracts/swap_router
movement move test
```

### Frontend Tests
```bash
cd frontend
npm test
```

## 🚀 Deployment

### Testnet
```bash
# Deploy contract
cd contracts/swap_router
./deploy.sh testnet

# Configure frontend
cd ../../frontend
# Edit src/config/network.js
npm run build
npm run preview
```

### Mainnet
```bash
# Deploy contract
cd contracts/swap_router
./deploy.sh mainnet

# Configure frontend
cd ../../frontend
# Edit src/config/network.js
npm run build
# Deploy to hosting (Vercel, Netlify, etc.)
```

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env` and fill in your values.

Create `frontend/.env`:
```env
VITE_NETWORK=mainnet              # or testnet
VITE_SWAP_ROUTER_ADDRESS=0x...    # Your deployed contract
```

### Network Settings

Edit `frontend/src/config/network.js`:
```javascript
export const DEFAULT_NETWORK = NETWORKS.MAINNET;
export const SWAP_ROUTER_ADDRESS = "0x...";
```

## 📊 Features Roadmap

### Phase 1: MVP ✅
- [x] Portfolio tracking
- [x] Basic swap
- [x] Mosaic integration
- [x] Fee collection

### Phase 2: Enhancement (Current)
- [ ] Full Yuzu integration
- [ ] Multi-hop visualization
- [ ] Advanced analytics
- [ ] Historical data

### Phase 3: Advanced
- [ ] Limit orders
- [ ] Price alerts
- [ ] Portfolio automation
- [ ] Advanced order types

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🆘 Support

- **Documentation**: See [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/devjwd/daftar/issues)
- **Movement Discord**: [discord.gg/movementnetwork](https://discord.gg/movementnetwork)
- **Mosaic Discord**: [discord.gg/mosaicagg](https://discord.gg/mosaicagg)

## 🔗 Resources

### Movement Network
- [Website](https://movementnetwork.xyz/)
- [Docs](https://docs.movementnetwork.xyz/)
- [Explorer](https://explorer.movementnetwork.xyz/)
- [Faucet](https://faucet.movementnetwork.xyz/)

### Protocols
- [Mosaic](https://mosaic.ag/) - DEX aggregator
- [Yuzu](https://yuzu.finance/) - CLMM DEX
- [Echelon](https://echelon.market/) - Lending
- [LayerBank](https://layerbank.finance/) - Lending
- [Canopy](https://canopyfinance.xyz/) - Liquid staking

## 🎉 Acknowledgments

Built with ❤️ for the Movement Network ecosystem.

Special thanks to:
- Movement Labs team
- Mosaic team for API access
- Yuzu team for CLMM innovation
- All DeFi protocol teams

---

**Happy Trading! 🚀**
