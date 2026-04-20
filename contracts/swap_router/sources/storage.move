/// =============================================================================
/// Movement Network Swap Router — Storage Module
/// =============================================================================
///
/// All persistent state lives here. The logic module (router.move) is the only
/// authorised caller. Upgrading logic never touches this module's resources.
///
/// Resource layout
///   RouterConfig       – partner fee settings, pause flag, admin addresses
///   RouteRegistry      – on-chain table of enabled/disabled aggregator routes
///   SwapStats          – global swap counter and cumulative fee totals
///   UserSwapStats      – per-user lifetime swap history
///
/// Key design change vs v1
///   • `charge_fee_by`        – b"token_in" | b"token_out"
///     Mosaic collects partner fees atomically inside the swap tx.
///     The frontend reads this value and passes it as `chargeFeeBy` to the
///     Mosaic SDK/API so the correct side of the trade is charged.
///   • `default_slippage_bps` – default slippage tolerance the frontend should
///     pass to Mosaic when building the swap quote.
///   • No coin escrow, no pre-swap fee withdrawal — Mosaic handles all of that.
///
/// Error codes owned by this module (4xx):
///   400 - E_ROUTE_NOT_FOUND
///   401 - E_ROUTE_ALREADY_EXISTS
/// =============================================================================

module swap_router::storage {
    use std::signer;
    use std::string::{Self, String};
    use std::vector;
    use aptos_framework::table::{Self, Table};

    // -------------------------------------------------------------------------
    // Friend declaration — only the logic module may call private fns
    // -------------------------------------------------------------------------

    friend swap_router::router;

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    const E_ROUTE_NOT_FOUND: u64       = 400;
    const E_ROUTE_ALREADY_EXISTS: u64  = 401;
    const E_ROUTE_NAME_TOO_LONG: u64   = 402;
    const E_ARITH_OVERFLOW: u64        = 403;
    const E_INVALID_ROUTE_ID: u64      = 404;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// Seeded at init; route_id 1 = Mosaic aggregator.
    const INITIAL_ROUTE_ID: u8         = 1;
    const INITIAL_ROUTE_NAME: vector<u8> = b"mosaic";

    /// Default slippage: 50 bps = 0.5%
    const DEFAULT_SLIPPAGE_BPS: u64    = 50;

    /// Default charge side for partner fee.
    const DEFAULT_CHARGE_FEE_BY: vector<u8> = b"token_in";

    /// Route name max length (bytes)
    const MAX_ROUTE_NAME_LEN: u64 = 64;

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct RouteInfo has store {
        name: String,
        enabled: bool,
        added_at: u64,
    }

    /// Global partner / protocol configuration.
    struct RouterConfig has key {
        /// Current admin address.
        admin: address,
        /// Nominated-but-not-yet-accepted admin (0x0 when none).
        pending_admin: address,
        /// Partner fee in basis points (100 bps = 1%).
        /// Passed as `feeBps` to the Mosaic API.
        fee_bps: u64,
        /// Wallet that receives the partner fee.
        /// Passed as `feeRecipient` / `partnerAddress` to the Mosaic API.
        /// Mosaic credits 85 % of the collected fee here; they keep 15 %.
        fee_treasury: address,
        /// Which side of the trade to charge: b"token_in" | b"token_out".
        /// Passed as `chargeFeeBy` to the Mosaic SDK.
        charge_fee_by: String,
        /// Default slippage tolerance (bps) surfaced to the frontend.
        /// Passed as `slippageBps` to the Mosaic SDK.
        default_slippage_bps: u64,
        /// Whether new swaps are blocked.
        paused: bool,
        /// Timestamp of the last config change.
        updated_at: u64,
    }

    /// Registry of aggregator routes.
    struct RouteRegistry has key {
        routes: Table<u8, RouteInfo>,
        count: u64,
    }

    /// Global aggregated swap statistics.
    /// fee_total tracks the partner fee that Mosaic reported back
    /// (self-reported by users via record_swap — analytics only).
    struct SwapStats has key {
        total_swaps: u64,
        total_fees_reported: u64,
        updated_at: u64,
    }

    /// Per-user swap history (analytics, self-reported).
    struct UserSwapStats has key {
        total_amount_in: u64,
        total_fees_reported: u64,
        swap_count: u64,
        first_swap_at: u64,
        last_swap_at: u64,
    }

    // =========================================================================
    // Friend-only initialiser
    // =========================================================================

    /// Called once by router::initialize.
    /// Seeds RouterConfig, RouteRegistry (with Mosaic route), and SwapStats.
    public(friend) fun init_config(
        admin: &signer,
        fee_bps: u64,
        fee_treasury: address,
        charge_fee_by: vector<u8>,
        default_slippage_bps: u64,
        now: u64,
    ) {
        let admin_addr = signer::address_of(admin);

        move_to(admin, RouterConfig {
            admin: admin_addr,
            pending_admin: @0x0,
            fee_bps,
            fee_treasury,
            charge_fee_by: string::utf8(charge_fee_by),
            default_slippage_bps,
            paused: false,
            updated_at: now,
        });

        // Seed the Mosaic route (route_id = 1)
        let routes = table::new<u8, RouteInfo>();
        table::add(&mut routes, INITIAL_ROUTE_ID, RouteInfo {
            name: string::utf8(INITIAL_ROUTE_NAME),
            enabled: true,
            added_at: now,
        });

        move_to(admin, RouteRegistry {
            routes,
            count: 1,
        });

        move_to(admin, SwapStats {
            total_swaps: 0,
            total_fees_reported: 0,
            updated_at: now,
        });
    }

    // =========================================================================
    // Existence checks
    // =========================================================================

    public fun config_exists(): bool {
        exists<RouterConfig>(@swap_router)
    }

    // =========================================================================
    // RouterConfig — getters
    // =========================================================================

    public fun get_admin(): address acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).admin
    }

    public fun get_pending_admin(): address acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).pending_admin
    }

    public fun is_paused(): bool acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).paused
    }

    /// Returns the full partner config tuple needed by the frontend to build
    /// a Mosaic API / SDK call.
    /// (fee_bps, fee_treasury, charge_fee_by, default_slippage_bps, paused)
    public fun get_partner_config(): (u64, address, String, u64, bool) acquires RouterConfig {
        let cfg = borrow_global<RouterConfig>(@swap_router);
        (
            cfg.fee_bps,
            cfg.fee_treasury,
            cfg.charge_fee_by,
            cfg.default_slippage_bps,
            cfg.paused,
        )
    }

    // =========================================================================
    // RouterConfig — setters (friend-only)
    // =========================================================================

    public(friend) fun set_pending_admin(addr: address, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.pending_admin = addr;
        cfg.updated_at   = now;
    }

    /// Atomically promotes pending_admin → admin.
    /// Returns the old admin address for event emission.
    public(friend) fun apply_admin_transfer(new_admin: address, now: u64): address acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        let old = cfg.admin;
        cfg.admin         = new_admin;
        cfg.pending_admin = @0x0;
        cfg.updated_at    = now;
        old
    }

    public(friend) fun set_fee_bps(bps: u64, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.fee_bps    = bps;
        cfg.updated_at = now;
    }

    public(friend) fun set_fee_treasury(treasury: address, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.fee_treasury = treasury;
        cfg.updated_at   = now;
    }

    public(friend) fun set_charge_fee_by(value: vector<u8>, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.charge_fee_by = string::utf8(value);
        cfg.updated_at    = now;
    }

    public(friend) fun set_default_slippage_bps(bps: u64, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.default_slippage_bps = bps;
        cfg.updated_at           = now;
    }

    public(friend) fun set_paused(paused: bool, now: u64) acquires RouterConfig {
        let cfg = borrow_global_mut<RouterConfig>(@swap_router);
        cfg.paused     = paused;
        cfg.updated_at = now;
    }

    // =========================================================================
    // RouteRegistry
    // =========================================================================

    public fun is_route_enabled(route_id: u8): bool acquires RouteRegistry {
        let reg = borrow_global<RouteRegistry>(@swap_router);
        if (!table::contains(&reg.routes, route_id)) { return false };
        table::borrow(&reg.routes, route_id).enabled
    }

    public fun get_route_count(): u64 acquires RouteRegistry {
        borrow_global<RouteRegistry>(@swap_router).count
    }

    public(friend) fun add_route(route_id: u8, name: vector<u8>, now: u64) acquires RouteRegistry {
        let reg = borrow_global_mut<RouteRegistry>(@swap_router);
        assert!(route_id > 0, E_INVALID_ROUTE_ID);
        assert!(!table::contains(&reg.routes, route_id), E_ROUTE_ALREADY_EXISTS);
        assert!(vector::length(&name) <= MAX_ROUTE_NAME_LEN, E_ROUTE_NAME_TOO_LONG);
        table::add(&mut reg.routes, route_id, RouteInfo {
            name: string::utf8(name),
            enabled: true,
            added_at: now,
        });
        let next_count = reg.count + 1;
        assert!(next_count >= reg.count, E_ARITH_OVERFLOW);
        reg.count = next_count;
    }

    public(friend) fun set_route_enabled(route_id: u8, enabled: bool) acquires RouteRegistry {
        let reg = borrow_global_mut<RouteRegistry>(@swap_router);
        assert!(table::contains(&reg.routes, route_id), E_ROUTE_NOT_FOUND);
        table::borrow_mut(&mut reg.routes, route_id).enabled = enabled;
    }

    // =========================================================================
    // SwapStats — global analytics (self-reported, informational only)
    // =========================================================================

    public(friend) fun record_global_swap(fee_reported: u64, now: u64) acquires SwapStats {
        let s = borrow_global_mut<SwapStats>(@swap_router);
        let next_swaps = s.total_swaps + 1;
        assert!(next_swaps >= s.total_swaps, E_ARITH_OVERFLOW);
        s.total_swaps = next_swaps;

        let next_fees = s.total_fees_reported + fee_reported;
        assert!(next_fees >= s.total_fees_reported, E_ARITH_OVERFLOW);
        s.total_fees_reported = next_fees;
        s.updated_at           = now;
    }

    public fun get_stats(): (u64, u64) acquires SwapStats {
        let s = borrow_global<SwapStats>(@swap_router);
        (s.total_swaps, s.total_fees_reported)
    }

    // =========================================================================
    // UserSwapStats — per-user analytics
    // =========================================================================

    public(friend) fun record_user_swap(
        user: &signer,
        amount_in: u64,
        fee_reported: u64,
        now: u64,
    ) acquires UserSwapStats {
        let addr = signer::address_of(user);

        if (!exists<UserSwapStats>(addr)) {
            move_to(user, UserSwapStats {
                total_amount_in:    amount_in,
                total_fees_reported: fee_reported,
                swap_count:         1,
                first_swap_at:      now,
                last_swap_at:       now,
            });
        } else {
            let s = borrow_global_mut<UserSwapStats>(addr);
            let next_amount = s.total_amount_in + amount_in;
            assert!(next_amount >= s.total_amount_in, E_ARITH_OVERFLOW);
            s.total_amount_in = next_amount;

            let next_fees = s.total_fees_reported + fee_reported;
            assert!(next_fees >= s.total_fees_reported, E_ARITH_OVERFLOW);
            s.total_fees_reported = next_fees;

            let next_count = s.swap_count + 1;
            assert!(next_count >= s.swap_count, E_ARITH_OVERFLOW);
            s.swap_count = next_count;
            s.last_swap_at        = now;
        }
    }

    public fun get_user_stats(user: address): (u64, u64, u64, u64, u64) acquires UserSwapStats {
        if (!exists<UserSwapStats>(user)) {
            return (0, 0, 0, 0, 0)
        };
        let s = borrow_global<UserSwapStats>(user);
        (
            s.total_amount_in,
            s.total_fees_reported,
            s.swap_count,
            s.first_swap_at,
            s.last_swap_at,
        )
    }
}