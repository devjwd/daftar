/// =============================================================================
/// Movement Network — Persistent Storage Module
/// =============================================================================
///
/// The permanent data layer for the entire protocol. Deployed ONCE, never
/// replaced. All product modules (swap, staking, lending) store state here
/// and survive unlimited logic upgrades.
///
/// ── Data layers ──────────────────────────────────────────────────────────────
///
///  LAYER 1 — RouterConfig          (swap protocol global config)
///  LAYER 2 — RouteRegistry         (dynamic swap route whitelist)
///  LAYER 3 — UserSwapStats         (per-user lifetime swap metrics)
///
///  RESERVED — StakingConfig        (add struct here when staking.move ships)
///  RESERVED — LendingConfig        (add struct here when lending.move ships)
///
/// ── Adding a new logic module ────────────────────────────────────────────────
///
///   1. Write your_module.move with new logic
///   2. Add `friend swap_router::your_module;` below (one line)
///   3. Publish storage.move (compatible upgrade — only adds a friend)
///   4. Publish your_module.move
///   → All existing data intact.
///
/// ── Authorized logic modules ─────────────────────────────────────────────────
///
///   swap_router::router     — swap router v1  (current)
///
///   Add new modules below as you ship them:
///   // friend swap_router::router_v2;
///   // friend swap_router::staking;
///   // friend swap_router::lending;
///
/// =============================================================================

module swap_router::storage {
    use std::signer;
    use aptos_std::table::{Self, Table};

    // ── Authorized writers ────────────────────────────────────────────────────
    friend swap_router::router;
    // friend swap_router::router_v2;   // uncomment when you ship router v2
    // friend swap_router::staking;     // uncomment when you ship staking
    // friend swap_router::lending;     // uncomment when you ship lending

    // ── Error codes ───────────────────────────────────────────────────────────
    const E_ALREADY_INITIALIZED: u64 = 301;
    const E_NOT_INITIALIZED: u64 = 302;
    const E_ROUTE_NOT_FOUND: u64 = 400;

    // =========================================================================
    // LAYER 1 — RouterConfig
    //
    // Global swap protocol config. One instance at @swap_router.
    // NEVER modify this struct after deployment — add RouterConfigV2 instead.
    // =========================================================================

    struct RouterConfig has key {
        admin: address,
        pending_admin: address,
        fee_bps: u64,
        fee_treasury: address,
        paused: bool,
        total_fees_collected: u64,
        total_swaps: u64,
        last_updated: u64,
    }

    // =========================================================================
    // LAYER 2 — RouteRegistry
    //
    // Dynamic whitelist of approved swap routes. Replaces hardcoded constants.
    // Stored at @swap_router alongside RouterConfig.
    //
    // Route IDs (stable forever — never reuse a deactivated ID):
    //   1 = Mosaic AMM
    //   2 = (reserve for next DEX)
    //   3 = (reserve for next DEX)
    // =========================================================================

    /// Metadata for a single approved swap route.
    /// `has store` (not `has key`) — lives inside RouteRegistry's Table.
    struct RouteInfo has store {
        name: vector<u8>,   // human-readable label e.g. b"mosaic"
        enabled: bool,      // can be toggled without removing the route
        added_at: u64,
    }

    /// Global route whitelist. One instance at @swap_router.
    struct RouteRegistry has key {
        /// route_id -> RouteInfo
        routes: Table<u8, RouteInfo>,
        /// total routes ever registered (monotonically increasing)
        count: u64,
    }

    // =========================================================================
    // LAYER 3 — UserSwapStats
    //
    // Lifetime swap metrics per user. Stored at each user's address the first
    // time they swap. On-chain leaderboard and profile data source.
    //
    // To add more per-user fields in the future, add UserSwapStatsV2 as a
    // separate resource at the user's address — do not modify this struct.
    // =========================================================================

    struct UserSwapStats has key {
        /// Cumulative raw input amount across all swaps (8-decimal units)
        total_amount_in: u64,
        /// Cumulative protocol fees paid to treasury
        total_fees_paid: u64,
        /// Total number of swaps executed
        swap_count: u64,
        /// Timestamp of user's very first swap
        first_swap_at: u64,
        /// Timestamp of user's most recent swap
        last_swap_at: u64,
    }

    // =========================================================================
    // RESERVED — Staking layer
    //
    // When you build staking.move, define your structs here:
    //
    // struct StakingConfig has key {
    //     reward_rate_bps: u64,
    //     min_lock_seconds: u64,
    //     total_staked: u64,
    //     paused: bool,
    //     last_updated: u64,
    // }
    //
    // struct UserStakePosition has key {
    //     staked_amount: u64,
    //     reward_debt: u64,
    //     locked_until: u64,
    //     last_claim_at: u64,
    // }
    //
    // Then add: friend swap_router::staking;
    // =========================================================================

    // =========================================================================
    // RESERVED — Lending/Borrowing layer
    //
    // When you build lending.move, define your structs here:
    //
    // struct LendingMarket has key {
    //     total_supplied: u64,
    //     total_borrowed: u64,
    //     utilization_rate_bps: u64,
    //     base_rate_bps: u64,
    //     paused: bool,
    //     last_updated: u64,
    // }
    //
    // struct UserLendingPosition has key {
    //     supplied: u64,
    //     borrowed: u64,
    //     collateral_factor_bps: u64,
    //     last_interest_at: u64,
    // }
    //
    // Then add: friend swap_router::lending;
    // =========================================================================

    // =========================================================================
    // Initialization
    // =========================================================================

    /// Set up all Layer 1 + Layer 2 state in one call.
    /// Called once by router::initialize. Aborts if already done.
    public(friend) fun init_config(
        deployer: &signer,
        fee_bps: u64,
        fee_treasury: address,
        now: u64,
    ) {
        assert!(!exists<RouterConfig>(@swap_router), E_ALREADY_INITIALIZED);

        // Layer 1 — global config
        move_to(deployer, RouterConfig {
            admin: signer::address_of(deployer),
            pending_admin: @0x0,
            fee_bps,
            fee_treasury,
            paused: false,
            total_fees_collected: 0,
            total_swaps: 0,
            last_updated: now,
        });

        // Layer 2 — route registry, pre-seeded with Mosaic (id = 1)
        let routes = table::new<u8, RouteInfo>();
        table::add(&mut routes, 1u8, RouteInfo {
            name: b"mosaic",
            enabled: true,
            added_at: now,
        });
        move_to(deployer, RouteRegistry {
            routes,
            count: 1,
        });
    }

    // =========================================================================
    // LAYER 1 — RouterConfig public getters (anyone can read)
    // =========================================================================

    public fun config_exists(): bool {
        exists<RouterConfig>(@swap_router)
    }

    public fun get_admin(): address acquires RouterConfig {
        assert!(exists<RouterConfig>(@swap_router), E_NOT_INITIALIZED);
        borrow_global<RouterConfig>(@swap_router).admin
    }

    public fun get_pending_admin(): address acquires RouterConfig {
        assert!(exists<RouterConfig>(@swap_router), E_NOT_INITIALIZED);
        borrow_global<RouterConfig>(@swap_router).pending_admin
    }

    public fun is_paused(): bool acquires RouterConfig {
        assert!(exists<RouterConfig>(@swap_router), E_NOT_INITIALIZED);
        borrow_global<RouterConfig>(@swap_router).paused
    }

    /// (total_swaps, total_fees_collected)
    public fun get_stats(): (u64, u64) acquires RouterConfig {
        assert!(exists<RouterConfig>(@swap_router), E_NOT_INITIALIZED);
        let c = borrow_global<RouterConfig>(@swap_router);
        (c.total_swaps, c.total_fees_collected)
    }

    /// (fee_bps, fee_treasury, total_fees, total_swaps, paused)
    public fun get_all(): (u64, address, u64, u64, bool) acquires RouterConfig {
        assert!(exists<RouterConfig>(@swap_router), E_NOT_INITIALIZED);
        let c = borrow_global<RouterConfig>(@swap_router);
        (c.fee_bps, c.fee_treasury, c.total_fees_collected, c.total_swaps, c.paused)
    }

    // =========================================================================
    // LAYER 2 — RouteRegistry public getters
    // =========================================================================

    /// Returns true if the route exists AND is currently enabled.
    public fun is_route_enabled(route_id: u8): bool acquires RouteRegistry {
        if (!exists<RouteRegistry>(@swap_router)) return false;
        let reg = borrow_global<RouteRegistry>(@swap_router);
        if (!table::contains(&reg.routes, route_id)) return false;
        table::borrow(&reg.routes, route_id).enabled
    }

    /// Total number of routes ever registered.
    public fun get_route_count(): u64 acquires RouteRegistry {
        assert!(exists<RouteRegistry>(@swap_router), E_NOT_INITIALIZED);
        borrow_global<RouteRegistry>(@swap_router).count
    }

    // =========================================================================
    // LAYER 3 — UserSwapStats public getters
    // =========================================================================

    /// Returns true if user has ever swapped.
    public fun user_stats_exist(user: address): bool {
        exists<UserSwapStats>(user)
    }

    /// (total_amount_in, total_fees_paid, swap_count, first_swap_at, last_swap_at)
    /// Returns all zeros if user has never swapped.
    public fun get_user_stats(user: address): (u64, u64, u64, u64, u64) acquires UserSwapStats {
        if (!exists<UserSwapStats>(user)) return (0, 0, 0, 0, 0);
        let s = borrow_global<UserSwapStats>(user);
        (s.total_amount_in, s.total_fees_paid, s.swap_count, s.first_swap_at, s.last_swap_at)
    }

    // =========================================================================
    // LAYER 1 — RouterConfig friend-only mutations
    // =========================================================================

    public(friend) fun set_fee_bps(new_fee: u64, now: u64) acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        c.fee_bps = new_fee;
        c.last_updated = now;
    }

    public(friend) fun set_fee_treasury(new_treasury: address, now: u64) acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        c.fee_treasury = new_treasury;
        c.last_updated = now;
    }

    public(friend) fun set_paused(is_paused: bool, now: u64) acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        c.paused = is_paused;
        c.last_updated = now;
    }

    public(friend) fun set_pending_admin(new_admin: address, now: u64) acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        c.pending_admin = new_admin;
        c.last_updated = now;
    }

    /// Finalize 2-step admin transfer. Returns old admin for event emission.
    public(friend) fun apply_admin_transfer(new_addr: address, now: u64): address acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        let old_admin = c.admin;
        c.admin = new_addr;
        c.pending_admin = @0x0;
        c.last_updated = now;
        old_admin
    }

    /// Update global swap counters. Always increments total_swaps.
    /// fee_collected = 0 when treasury wasn't registered (fee returned to user).
    public(friend) fun record_global_swap(fee_collected: u64, now: u64) acquires RouterConfig {
        let c = borrow_global_mut<RouterConfig>(@swap_router);
        c.total_swaps = c.total_swaps + 1;
        c.total_fees_collected = c.total_fees_collected + fee_collected;
        c.last_updated = now;
    }

    // =========================================================================
    // LAYER 2 — RouteRegistry friend-only mutations
    // =========================================================================

    /// Register a new swap route. Aborts if route_id already exists.
    public(friend) fun add_route(
        route_id: u8,
        name: vector<u8>,
        now: u64,
    ) acquires RouteRegistry {
        let reg = borrow_global_mut<RouteRegistry>(@swap_router);
        assert!(!table::contains(&reg.routes, route_id), E_ALREADY_INITIALIZED);
        table::add(&mut reg.routes, route_id, RouteInfo {
            name,
            enabled: true,
            added_at: now,
        });
        reg.count = reg.count + 1;
    }

    /// Enable or disable a route without removing it.
    /// Aborts if route_id was never registered.
    public(friend) fun set_route_enabled(
        route_id: u8,
        enabled: bool,
    ) acquires RouteRegistry {
        let reg = borrow_global_mut<RouteRegistry>(@swap_router);
        assert!(table::contains(&reg.routes, route_id), E_ROUTE_NOT_FOUND);
        table::borrow_mut(&mut reg.routes, route_id).enabled = enabled;
    }

    // =========================================================================
    // LAYER 3 — UserSwapStats friend-only mutations
    // =========================================================================

    /// Record a swap for a specific user.
    /// Creates UserSwapStats on the user's account if this is their first swap.
    /// Requires the user's signer — called from router::collect_fee.
    public(friend) fun record_user_swap(
        user: &signer,
        amount_in: u64,
        fee_paid: u64,
        now: u64,
    ) acquires UserSwapStats {
        let user_addr = signer::address_of(user);
        if (!exists<UserSwapStats>(user_addr)) {
            // First-ever swap: create the stats resource at user's address
            move_to(user, UserSwapStats {
                total_amount_in: amount_in,
                total_fees_paid: fee_paid,
                swap_count: 1,
                first_swap_at: now,
                last_swap_at: now,
            });
        } else {
            let s = borrow_global_mut<UserSwapStats>(user_addr);
            s.total_amount_in = s.total_amount_in + amount_in;
            s.total_fees_paid = s.total_fees_paid + fee_paid;
            s.swap_count = s.swap_count + 1;
            s.last_swap_at = now;
        };
    }
}
