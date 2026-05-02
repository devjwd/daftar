# <img src="frontend/public/logo.png" width="40" height="40" /> Daftar

### The High-Fidelity Portfolio Management Suite for Movement Network

![Daftar Banner](daftar_banner_1777750428877.png)

[![Deployed on Vercel](https://img.shields.io/badge/Frontend-Vercel-black?style=for-the-badge&logo=vercel)](https://daftar.fi)
[![Hosted on Railway](https://img.shields.io/badge/Backend-Railway-0B0D0E?style=for-the-badge&logo=railway)](https://railway.app)
[![Built on Movement](https://img.shields.io/badge/Network-Movement-blue?style=for-the-badge)](https://movementnetwork.xyz)
[![Powered by Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com)

**Daftar** is a premium, state-of-the-art DeFi portfolio manager designed specifically for the **Movement Network**. It offers a seamless bridge between complex on-chain data and a beautiful, high-performance user interface.

---

## ✨ Key Features

### 💎 Advanced Portfolio Discovery
*   **Deep Scan Engine**: Automatically identifies balances and positions across the entire Movement ecosystem.
*   **Protocol Integration**: Native support for **Meridian**, **Echelon**, **LayerBank**, **Yuzu Swap**, and **Canopy Finance**.
*   **LP & DeFi Valuation**: Real-time USD valuation for complex liquidity positions and lending/borrowing health ratios.

### 🏆 Achievement & SBT Ecosystem
*   **On-Chain Badges**: Secure Soulbound Token (SBT) system for tracking user milestones.
*   **Dynamic Attestation**: Real-time server-side evaluation of user eligibility based on volume, liquidity, and loyalty.
*   **Verified Entities**: Automated branding for verified protocols (Entities) showing official logos, social links, and website info.

### ⚡ Professional Trading Tools
*   **DEX Aggregation**: Integrated **Mosaic API** for optimal swap routing and minimal price impact.
*   **Real-time Analytics**: Portfolio PnL tracking and historical transaction history with sub-second resolution.
*   **Premium UX**: A responsive, glassmorphism-inspired interface with smooth micro-animations and intuitive navigation.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 18, Vite, Ethers.js, Aptos SDK |
| **Backend** | Node.js (Express), Railway |
| **Database** | Supabase (PostgreSQL), Real-time Indexers |
| **Contracts** | Move (Aptos-compatible) |
| **Hosting** | Vercel (Frontend), Railway (Backend) |

---

## 📂 Project Structure

```bash
Daftar/
├── frontend/           # React 18 + Vite (Production-Hardened PWA)
│   ├── src/services/   # API orchestration & position discovery engines
│   ├── src/config/     # Network, token, and badge registries
│   └── src/pages/      # State-of-the-art dashboard and swap views
├── server/             # Express.js Backend (Railway)
│   ├── index.js        # Hardened API endpoints & Badge evaluation
│   └── .env.example    # Environment configuration
├── contracts/          # Move Smart Contracts
│   ├── swap_router/    # Fee-sharing DEX router
│   └── badges/         # SBT Achievement modules
└── supabase/           # Database layer
    └── migrations/     # RLS-enabled production schema
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- Movement Wallet (Razor, Nightly, or Petra)
- Supabase Account

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/devjwd/daftar.git
   cd daftar
   ```

2. **Setup Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. **Setup Backend**
   ```bash
   cd server
   npm install
   # Configure .env with your keys
   npm start
   ```

---

## 🔐 Security & Hardening

*   **Cryptographic Signing**: Badge minting is authorized via server-side signatures using a secure Ed25519 attestor key.
*   **Address Normalization**: Strict 64-character hex normalization prevents spoofing and ensures data integrity.
*   **RLS Policies**: Supabase Row Level Security ensures users can only modify their own profile data.
*   **Proxy Architecture**: External APIs (like Mosaic) are proxied through our backend to keep API keys secure.

---

## 🎯 Roadmap

- [x] **Core Engine**: Real-time position discovery for major protocols.
- [x] **Backend Migration**: Transitioned to dedicated Railway infrastructure for stability.
- [x] **Entity System**: Implementation of verified protocol branding and official links.
- [x] **SBT Claims**: Functional on-chain achievement minting with attestation.
- [ ] **Phase 4**: Advanced Yield Optimizer and Strategy Automations (Coming Soon).

---

Built with ❤️ by the **Daftar Team** for the **Movement Network** ecosystem. 🚀
