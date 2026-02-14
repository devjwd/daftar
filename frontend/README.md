# Movement Network Portfolio Tracker

A production-ready DeFi portfolio tracker for Movement Network, inspired by DeBank. Track your wallet balances, DeFi positions, and swap tokens on Movement blockchain.

## Features

- 🔗 **Wallet Connection** - Support for Petra, OKX, and other Movement-compatible wallets
- 🔍 **Address Search** - Search and view any Movement Network address portfolio
- 💼 **Portfolio Tracking** - Real-time token balances and USD valuations
- 📊 **DeFi Positions** - Track positions across multiple DeFi protocols
- 🔄 **Token Swap** - Swap interface for Movement Network tokens
- ⚡ **Indexer Integration** - Uses Movement Indexer API for efficient data fetching
- 🎨 **Modern UI** - Clean, DeBank-inspired interface with glassmorphism design

## Tech Stack

- **React 19** - UI framework
- **Vite** - Build tool
- **Movement Network SDK** - Blockchain interaction
- **GraphQL** - Movement Indexer API integration
- **CoinGecko API** - Token price data

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Movement-compatible wallet (Petra, OKX, etc.)

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables

Create a `.env` file in the `frontend` directory (optional):

```env
VITE_NETWORK=mainnet  # or "testnet"
```

## Project Structure

```
frontend/
├── src/
│   ├── components/          # React components
│   │   ├── ErrorBoundary.jsx
│   │   ├── Swap.jsx          # Token swap component
│   │   └── Swap.css
│   ├── config/               # Configuration files
│   │   ├── adapters/         # DeFi protocol adapters
│   │   ├── constants.js      # App constants
│   │   ├── network.js        # Network configuration
│   │   └── tokens.js         # Token registry
│   ├── hooks/                # Custom React hooks
│   │   ├── useDeFiPositions.js
│   │   ├── useIndexerBalances.js
│   │   └── useTokenPrices.js
│   ├── services/             # API services
│   │   └── indexer.js        # Movement Indexer GraphQL client
│   ├── utils/                # Utility functions
│   │   └── tokenUtils.js
│   ├── App.jsx               # Main application component
│   ├── App.css               # Main styles
│   └── main.jsx              # Entry point
├── public/                   # Static assets
└── package.json
```

## Movement Network Integration

### Indexer API

This project uses the [Movement Network Indexer](https://docs.movementnetwork.xyz/devs/indexing) for efficient data fetching:

- **Mainnet**: `https://indexer.mainnet.movementnetwork.xyz/v1/graphql`
- **Testnet**: `https://indexer.testnet.movementnetwork.xyz/v1/graphql`

The indexer provides:
- Faster token balance queries
- Historical transaction data
- Aggregate portfolio data
- Better performance than direct RPC calls

### Supported Networks

- **Mainnet**: Production Movement Network
- **Testnet**: Movement Testnet

## DeFi Protocol Support

The portfolio tracker includes adapters for multiple DeFi protocols:

- Razor
- Yuzu
- Echelon
- Meridian
- LayerBank
- Mosaic
- Canopy
- Joule
- MovePosition

## Development

### Adding a New DeFi Protocol Adapter

1. Create a new adapter file in `src/config/adapters/`
2. Export an array of position types with:
   - `id`: Unique identifier
   - `name`: Display name
   - `type`: Position type (Lending, Staking, LP, Debt)
   - `searchString`: Resource type pattern to match
   - `parse`: Function to extract value from resource data
3. Import and add to `src/config/adapters/index.js`

### Adding Token Price Support

Update `src/hooks/useTokenPrices.js` with CoinGecko token IDs:

```javascript
const COINGECKO_IDS = {
  "0x1::aptos_coin::AptosCoin": "aptos",
  // Add more tokens...
};
```

## Production Deployment

### Build

```bash
npm run build
```

The production build will be in the `dist/` directory.

### Environment Configuration

Set `VITE_NETWORK` environment variable:
- `mainnet` for production
- `testnet` for testing

### Recommended Hosting

- **Vercel** - Zero-config deployment
- **Netlify** - Static site hosting
- **Cloudflare Pages** - Global CDN
- **AWS S3 + CloudFront** - Enterprise hosting

## API Documentation

- [Movement Network API](https://docs.movementnetwork.xyz/api)
- [Movement Indexer](https://docs.movementnetwork.xyz/devs/indexing)
- [Movement Network Explorer](https://explorer.movementnetwork.xyz)

## License

MIT

## Support

For issues and questions:
- Movement Network Docs: https://docs.movementnetwork.xyz
- Movement Network Explorer: https://explorer.movementnetwork.xyz
