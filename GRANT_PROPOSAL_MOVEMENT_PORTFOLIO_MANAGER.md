# Movement Network Grant Proposal

## Project
Movement Portfolio Manager (Open-Source)

## One-line summary
We are building a simple, reliable DeFi dashboard for Movement where users can track assets, DeFi positions, transaction history, and weekly/monthly PnL in one place.

## Who we are building for
Movement users currently jump between explorer pages, protocol UIs, and wallet screens just to answer basic questions:
- What do I hold right now?
- What did I do this week?
- Am I in profit or loss this month?

Our goal is to make this easy with one Movement-native interface.

## What we have already built
- Wallet and address-based portfolio view
- Token balances with USD value
- DeFi position tracking across Movement protocols (adapter-based architecture)
- Swap interface integration
- Indexer-first data flow with RPC fallback

This grant is to make the product production-grade and more useful for everyday users.

## What we will add with this grant

### 1) Transaction History (new)
Users will be able to view full wallet activity in one clear timeline:
- Swaps
- Transfers
- Deposits/withdrawals
- Lending/staking interactions
- Fees and timestamps

Key output:
- Filterable history (type/date/token)
- Clean labels so non-technical users can understand each transaction

### 2) PnL System (new)
Users will see their performance without spreadsheet work:
- Weekly PnL
- Monthly PnL
- Realized and unrealized views (where possible)
- Token and portfolio-level PnL summary

Key output:
- PnL cards and trend summaries directly in portfolio UI
- Consistent calculation logic documented publicly

### 3) Core reliability improvements
- Better indexer + RPC fallback handling
- Better token decimal and pricing accuracy
- Better error handling and loading states

### 4) Open-source ecosystem tooling
- Keep adapters and integration logic open-source
- Publish docs for adding new Movement protocol adapters
- Ship reusable patterns other Movement teams can build on

## Why this fits Movement grants
- Built specifically for Movement data patterns and DeFi ecosystem
- Open-source public good (not closed private tooling)
- Directly improves usability and on-chain retention
- Helps new users understand portfolio and activity faster

## Timeline (12 weeks)

### Milestone 1 (Weeks 1-4): History Engine
- Build transaction history indexing + normalization layer
- Add history UI with filters/search
- Test with real Movement addresses

### Milestone 2 (Weeks 5-8): PnL Engine
- Implement weekly/monthly PnL calculations
- Add portfolio and token-level PnL UI
- Validate output accuracy with test datasets

### Milestone 3 (Weeks 9-12): Hardening + Docs
- Reliability improvements and performance cleanup
- Documentation for adapters, history, and PnL logic
- Public release + ecosystem onboarding support

## Budget (Pakistan-market adjusted)

### Total grant request: **USD 24,000**

This budget is based on Pakistan market rates for experienced web3/full-stack contributors and a 3-month delivery window.

### Detailed use of funds

1) Engineering (Core build): **USD 16,200**
- Full-stack lead engineer (history + PnL architecture, 3 months): USD 7,500
- Frontend engineer (UI/UX implementation, 3 months): USD 4,500
- Data/indexer engineer (query optimization + normalization, part-time): USD 2,700
- Smart contract integration support / technical advisor (part-time): USD 1,500

2) QA and testing: **USD 2,100**
- Test case writing, regression checks, validation of PnL math, cross-wallet checks

3) DevOps and infra: **USD 1,700**
- Hosting, monitoring, RPC/indexer usage, CI pipelines, logs and alerting

4) Documentation and developer support: **USD 1,500**
- Integration docs, adapter guides, release notes, onboarding calls with ecosystem teams

5) Product design and UX polish: **USD 1,200**
- Information hierarchy for history/PnL pages and usability refinement

6) Contingency: **USD 1,300**
- For protocol/indexer schema changes and unplanned integration issues

**Grand Total: USD 24,000**

## How funds will be released
We are happy with milestone-based disbursement:
- Milestone 1: USD 8,000
- Milestone 2: USD 8,000
- Milestone 3: USD 8,000

## Success metrics
- Users can view complete wallet transaction history from one interface
- Weekly and monthly PnL available for supported assets/protocol flows
- Portfolio data reliability above 99% for supported queries
- Public docs published for history/PnL/adapters
- At least 2 Movement ecosystem teams reuse or reference our open tooling patterns

## Risks and mitigation
- Data inconsistencies across protocols: solved via normalization and fallback strategy
- PnL complexity across DeFi actions: transparent documented logic and staged rollout
- Indexer changes: adapter abstraction and test coverage to reduce breakage

## Open-source commitment
We will keep core portfolio, history, and PnL implementation open-source and documented so it benefits the wider Movement ecosystem.

## Closing note
We already have a working portfolio foundation on Movement. This grant helps us deliver the two features users ask for most—**clear transaction history** and **easy weekly/monthly PnL**—while keeping the work open and reusable for the entire ecosystem.

---

## Submission checklist (before final form submit)
- Add team contact details
- Add repo and live demo links
- Add short team bios
- Add any current usage numbers (if available)