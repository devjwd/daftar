# Daftar: Movement Network Portfolio Manager

[![Deployed on Vercel](https://img.shields.io/badge/deployed-vercel-black.svg)](https://daftar.movementnetwork.xyz)
[![Built on Movement](https://img.shields.io/badge/built%20on-Movement-blue.svg)](https://movementnetwork.xyz)
[![Hardened: Production](https://img.shields.io/badge/security-hardened-success.svg)](#security-hardening)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Daftar** is a high-fidelity DeFi portfolio manager and achievement ecosystem optimized for the Movement Network. It provides real-time position discovery, hardened transaction history, and a secure, cryptographically-signed SBT badge system for on-chain status.

---

## 🌟 Production Features

### 📊 Hardened Portfolio Engine
- **Cross-Protocol Detection**: Intelligent discovery of lending, staking, and LP positions across Echelon, LayerBank, Meridian, Yuzu, and more.
- **Consolidated Transaction History**: A server-side history engine with multi-route enrichment and intelligent caching for sub-second performance.
- **Dynamic Entity Mapping**: Real-time resolution of protocol branding and metadata via a hardened entity registry.

### 🛡️ Secure Achievement System (v2)
- **Soulbound Badges (SBT)**: Earn permanent, non-transferable achievements for trade volume, protocol loyalty, and community milestones.
- **Auto-Awarding Engine**: A robust background evaluation service that triggers eligibility in real-time as users interact with the network.
- **Cryptographic Trust**: All badges are evaluated server-side and cryptographically signed using a secure attestor key to ensure data integrity.

### 💱 State-of-the-Art UX
- **Smart Routing**: Integrated Mosaic DEX aggregator and Yuzu CLMM for optimal swap rates and minimal slippage.
- **Premium Aesthetics**: A state-of-the-art glassmorphism UI with smooth micro-animations and intuitive navigation.

---

## 📁 System Architecture

```bash
Daftar/
├── frontend/               # React 18 + Vite (Production-Hardened PWA)
│   ├── src/config/         # Consolidated network, token, and badge registries
│   ├── src/services/       # API orchestration & position discovery engines
│   └── src/hooks/          # Real-time state management & polling
├── supabase/               # Backend-as-a-Service layer
│   ├── functions/          # Hardened Edge Functions (Badge evaluation & signing)
│   ├── migrations/         # Secure DB migrations with RLS enabled
│   └── schema.sql          # Master production schema with optimized indexing
└── contracts/              # Move Smart Contracts (Fee Router & SBT Modules)
```

---

## 🚀 Deployment & Configuration

### 1. Smart Contract Deployment
Deploy the Move contracts to Movement Mainnet:
```bash
cd contracts/swap_router
./deploy.sh mainnet
```

### 2. Backend Infrastructure
Ensure the Supabase environment is hardened and Edge Functions are deployed:
```bash
# Deploy hardened evaluation functions
supabase functions deploy award-badge
supabase functions deploy manage-badge-definition
supabase functions deploy import-allowlist
```

### 3. Production Secrets
Configure the following secrets in the Supabase Dashboard:
- `BADGE_SIGNER_PRIVATE_KEY`: Private key for the badge attestor (required for SBT signing).
- `ADMIN_WALLET_ADDRESS`: Authorized move address for administrative actions.
- `VERIFY_BADGE_API_KEY`: Internal authentication key for service-to-service calls.

---

## 🔧 Infrastructure Tuning

### Network Configuration
Production settings are tuned in `frontend/src/config/network.js`:
```javascript
export const DEFAULT_NETWORK = {
  chainId: 126,
  name: "Movement Mainnet",
  explorer: "https://explorer.movementnetwork.xyz",
  indexer: "https://indexer.mainnet.movementnetwork.xyz/v1/graphql"
};
```

---

## 🎯 Roadmap & Milestone Tracking

- [x] **Phase 1: Foundation**: Core portfolio tracking and Mosaic aggregation.
- [x] **Phase 2: Hardening**: Consolidated DB schema, RLS implementation, and hardened transaction engine.
- [x] **Phase 3: Achievements**: Secure SBT badge system with background auto-award service.
- [/] **Phase 4: Expansion**: Advanced DeFi yield optimizer and limit order functionality (Development).

---

## 🤝 Contributing & Security
Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md). For security vulnerabilities, please contact the maintainers directly.

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ by the **Daftar Team** for the **Movement Network** ecosystem. 🚀

