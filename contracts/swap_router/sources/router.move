/// =============================================================================
/// Movement Network Swap Router — Logic Module  (v2, Mosaic-native fees)
/// =============================================================================
///
/// ## What changed from v1 and why
///
/// v1 had a `collect_fee` entry function that withdrew coins from the user
/// BEFORE the Mosaic swap ran.  That design had three fatal problems:
///
///   1. Double-charging — Mosaic's own partner-fee params (feeBps / feeRecipient)
///      would deduct fees again inside the swap transaction.
///
///   2. Broken slippage — the Mosaic quote was computed for `amount_in`, but
///      the swap received `amount_in - fee`, so Mosaic's slippage guard was
///      protecting the wrong value.
///
///   3. Non-atomicity — fee and swap were two separate transactions.  A swap
///      failure after the fee tx left the user out-of-pocket.
///
/// ## Correct Mosaic integration (v2)
///
/// Mosaic collects partner fees atomically INSIDE the swap transaction.
/// Partners configure three parameters and pass them to the Mosaic SDK/API:
///
///   feeBps          → how much to charge (basis points, e.g. 30 = 0.3 %)
///   feeRecipient    → wallet that receives 85 % of the partner fee
///   chargeFeeBy     → "token_in" | "token_out"
///
/// This contract stores those values on-chain.  The frontend reads them via
/// `get_partner_config()` when constructing every Mosaic SDK call.
/// Fees flow: user → Mosaic swap contract → 85 % to fee_treasury, 15 % to Mosaic.
/// The partner then claims accumulated fees via the Mosaic Fee Claim Portal.
///
/// ## Slippage
///
/// `default_slippage_bps` is stored here and surfaced to the frontend so all
/// integrations use a consistent tolerance. The frontend passes it as
/// `slippageBps` to the Mosaic SDK.
///
/// ## Analytics
///
/// `record_swap` is an optional entry function users call AFTER a successful
/// Mosaic swap. It only updates counters and emits events — it does not touch
/// any coins. Data is self-reported and intended for off-chain dashboards.
///
/// ## Upgrade path
///
///   1. Write router_v3.move with new logic
///   2. Add `friend swap_router::router_v3;` to storage.move
///   3. Publish storage.move (compatible upgrade), then router_v3.move
///   → All user stats, config, and route registry intact.
///
/// Error codes (1xx = auth, 2xx = validation, 3xx = state):
///   100 - E_NOT_ADMIN
///   101 - E_NOT_PENDING_ADMIN
///   102 - E_INVALID_ADMIN
///   200 - E_INVALID_FEE
///   201 - E_ZERO_AMOUNT
///   202 - E_INVALID_CHARGE_FEE_BY
///   203 - E_INVALID_SLIPPAGE
///   204 - E_UNSUPPORTED_ROUTER_SOURCE
///   205 - E_INVALID_TREASURY
///   300 - E_PAUSED
///   301 - E_ALREADY_INITIALIZED
///   302 - E_NOT_INITIALIZED
/// =============================================================================

module swap_router::router {
    use std::signer;
    use std::string;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use swap_router::storage;

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    const E_NOT_ADMIN: u64              = 100;
    const E_NOT_PENDING_ADMIN: u64      = 101;
    const E_INVALID_ADMIN: u64          = 102;
    const E_INVALID_FEE: u64            = 200;
    const E_ZERO_AMOUNT: u64            = 201;
    const E_INVALID_CHARGE_FEE_BY: u64  = 202;
    const E_INVALID_SLIPPAGE: u64       = 203;
    const E_UNSUPPORTED_ROUTER_SOURCE: u64 = 204;
    const E_INVALID_TREASURY: u64       = 205;
    const E_AMOUNT_TOO_LARGE: u64       = 206;
    const E_INVALID_REPORTED_FEE: u64   = 207;
    const E_PAUSED: u64                 = 300;
    const E_ALREADY_INITIALIZED: u64    = 301;
    const E_NOT_INITIALIZED: u64        = 302;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// Maximum partner fee: 5 % = 500 bps
    const MAX_FEE_BPS: u64             = 500;

    /// Maximum slippage: 50 % = 5000 bps
    const MAX_SLIPPAGE_BPS: u64        = 5000;

    /// Fee denominator
    const BPS_DENOMINATOR: u64         = 10_000;

    /// Upper bound for a single self-reported analytics record.
    const MAX_REPORTED_AMOUNT_IN: u64  = 1_000_000_000_000_000;

    /// Valid charge_fee_by values
    const CHARGE_TOKEN_IN: vector<u8>  = b"token_in";
    const CHARGE_TOKEN_OUT: vector<u8> = b"token_out";

    /// Stable route IDs — never reuse a deactivated ID.
    const ROUTER_MOSAIC: u8            = 1;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// Emitted when a user calls record_swap after a completed Mosaic swap.
    /// Data is self-reported; no coins are moved by this event.
    #[event]
    struct SwapRecorded has drop, store {
        user: address,
        router_source: u8,
        amount_in: u64,
        /// Partner fee Mosaic reported as collected (85 % went to treasury).
        fee_reported: u64,
        /// Effective amount after fee (informational).
        net_amount: u64,
        timestamp: u64,
    }

    #[event]
    struct ConfigUpdated has drop, store {
        admin: address,
        field: vector<u8>,
        timestamp: u64,
    }

    #[event]
    struct AdminTransferInitiated has drop, store {
        current_admin: address,
        pending_admin: address,
        timestamp: u64,
    }

    #[event]
    struct AdminTransferCompleted has drop, store {
        old_admin: address,
        new_admin: address,
        timestamp: u64,
    }

    #[event]
    struct RouteUpdated has drop, store {
        route_id: u8,
        enabled: bool,
        timestamp: u64,
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /// Initialize the router. Can only be called once by the module deployer.
    ///
    /// Parameters
    ///   fee_bps              – partner fee in bps (max 500 = 5 %)
    ///   fee_treasury         – address passed as `feeRecipient` to Mosaic
    ///   charge_fee_by        – b"token_in" | b"token_out"
    ///   default_slippage_bps – default slippage for frontend (e.g. 50 = 0.5 %)
    public entry fun initialize(
        admin: &signer,
        fee_bps: u64,
        fee_treasury: address,
        charge_fee_by: vector<u8>,
        default_slippage_bps: u64,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @swap_router,              E_INVALID_ADMIN);
        assert!(!storage::config_exists(),               E_ALREADY_INITIALIZED);
        assert!(fee_bps <= MAX_FEE_BPS,                  E_INVALID_FEE);
        assert!(fee_treasury != @0x0,                    E_INVALID_TREASURY);
        assert!(is_valid_charge_fee_by(&charge_fee_by),  E_INVALID_CHARGE_FEE_BY);
        assert!(default_slippage_bps <= MAX_SLIPPAGE_BPS, E_INVALID_SLIPPAGE);

        let now = timestamp::now_seconds();
        storage::init_config(admin, fee_bps, fee_treasury, charge_fee_by, default_slippage_bps, now);

        event::emit(ConfigUpdated {
            admin: admin_addr,
            field: b"initialized",
            timestamp: now,
        });
    }

    // -------------------------------------------------------------------------
    // Admin management (2-step transfer)
    // -------------------------------------------------------------------------

    /// Step 1: Current admin nominates a new admin.
    public entry fun transfer_admin(admin: &signer, new_admin: address) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let current_admin = storage::get_admin();
        assert!(signer::address_of(admin) == current_admin, E_NOT_ADMIN);
        assert!(new_admin != @0x0,          E_INVALID_ADMIN);
        assert!(new_admin != current_admin, E_INVALID_ADMIN);

        let now = timestamp::now_seconds();
        storage::set_pending_admin(new_admin, now);

        event::emit(AdminTransferInitiated {
            current_admin,
            pending_admin: new_admin,
            timestamp: now,
        });
    }

    /// Step 2: Pending admin accepts the role.
    public entry fun accept_admin(new_admin: &signer) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let new_admin_addr = signer::address_of(new_admin);
        assert!(new_admin_addr == storage::get_pending_admin(), E_NOT_PENDING_ADMIN);

        let now = timestamp::now_seconds();
        let old_admin = storage::apply_admin_transfer(new_admin_addr, now);

        event::emit(AdminTransferCompleted {
            old_admin,
            new_admin: new_admin_addr,
            timestamp: now,
        });
    }

    /// Cancel a pending admin transfer.
    public entry fun cancel_admin_transfer(admin: &signer) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        storage::set_pending_admin(@0x0, timestamp::now_seconds());
    }

    // -------------------------------------------------------------------------
    // Partner config management (admin only)
    // -------------------------------------------------------------------------

    /// Update the partner fee in bps (max 500 = 5 %).
    /// Takes effect on the next Mosaic API call the frontend makes.
    public entry fun update_fee(admin: &signer, new_fee_bps: u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        assert!(new_fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);

        let now = timestamp::now_seconds();
        storage::set_fee_bps(new_fee_bps, now);

        event::emit(ConfigUpdated {
            admin: signer::address_of(admin),
            field: b"fee_bps",
            timestamp: now,
        });
    }

    /// Update the treasury / feeRecipient address.
    /// Receives 85 % of every partner fee collected by Mosaic going forward.
    public entry fun update_treasury(admin: &signer, new_treasury: address) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        assert!(new_treasury != @0x0, E_INVALID_TREASURY);

        let now = timestamp::now_seconds();
        storage::set_fee_treasury(new_treasury, now);

        event::emit(ConfigUpdated {
            admin: signer::address_of(admin),
            field: b"fee_treasury",
            timestamp: now,
        });
    }

    /// Update which side of the trade is charged.
    ///   b"token_in"  – fee taken from input before swap executes.
    ///   b"token_out" – fee taken from output after swap executes.
    /// Maps to Mosaic SDK's `chargeFeeBy` parameter.
    public entry fun update_charge_fee_by(admin: &signer, charge_fee_by: vector<u8>) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        assert!(is_valid_charge_fee_by(&charge_fee_by), E_INVALID_CHARGE_FEE_BY);

        let now = timestamp::now_seconds();
        storage::set_charge_fee_by(charge_fee_by, now);

        event::emit(ConfigUpdated {
            admin: signer::address_of(admin),
            field: b"charge_fee_by",
            timestamp: now,
        });
    }

    /// Update the default slippage tolerance surfaced to the frontend.
    /// Maps to Mosaic SDK's `slippageBps` parameter (50 = 0.5 %).
    public entry fun update_default_slippage(admin: &signer, new_slippage_bps: u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        assert!(new_slippage_bps <= MAX_SLIPPAGE_BPS, E_INVALID_SLIPPAGE);

        let now = timestamp::now_seconds();
        storage::set_default_slippage_bps(new_slippage_bps, now);

        event::emit(ConfigUpdated {
            admin: signer::address_of(admin),
            field: b"default_slippage_bps",
            timestamp: now,
        });
    }

    /// Emergency pause: frontend must check `is_paused()` before offering swaps.
    public entry fun set_paused(admin: &signer, is_paused: bool) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);

        let now = timestamp::now_seconds();
        storage::set_paused(is_paused, now);

        event::emit(ConfigUpdated {
            admin: signer::address_of(admin),
            field: if (is_paused) { b"paused" } else { b"unpaused" },
            timestamp: now,
        });
    }

    // -------------------------------------------------------------------------
    // Route management
    // -------------------------------------------------------------------------

    /// Register a new aggregator route (admin only).
    /// route_id must be unique — pick the next unused integer.
    public entry fun add_route(admin: &signer, route_id: u8, name: vector<u8>) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);

        let now = timestamp::now_seconds();
        storage::add_route(route_id, name, now);

        event::emit(RouteUpdated { route_id, enabled: true, timestamp: now });
    }

    /// Enable or disable an existing route (admin only).
    public entry fun set_route_enabled(admin: &signer, route_id: u8, enabled: bool) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);

        storage::set_route_enabled(route_id, enabled);

        event::emit(RouteUpdated {
            route_id,
            enabled,
            timestamp: timestamp::now_seconds(),
        });
    }

    // -------------------------------------------------------------------------
    // Post-swap analytics recorder
    // -------------------------------------------------------------------------

    /// Record a completed Mosaic swap for on-chain analytics.
    ///
    /// ┌──────────────────────────────────────────────────────────────────┐
    /// │  NO COINS ARE MOVED BY THIS FUNCTION.                           │
    /// │  The actual fee was already collected by Mosaic atomically       │
    /// │  inside the swap transaction. This only updates counters and     │
    /// │  emits events. Data is self-reported by the user.               │
    /// └──────────────────────────────────────────────────────────────────┘
    ///
    /// Recommended frontend flow:
    ///   1. Read config  → get_partner_config()
    ///   2. Check        → !is_paused()
    ///   3. Get quote    → GET /v1/quote?...&feeBps=X&feeRecipient=Y
    ///                                      &chargeFeeBy=Z&slippageBps=W
    ///   4. Submit swap  → single atomic Mosaic SDK transaction
    ///   5. After confirm→ call record_swap(amount_in, feeAmount_from_quote, route_id)
    ///
    /// Parameters
    ///   amount_in    – input amount passed to Mosaic (coin decimals)
    ///   fee_reported – feeAmount from the Mosaic quote response
    ///   router_source– route_id used (must be an enabled route)
    public entry fun record_swap(
        user: &signer,
        amount_in: u64,
        fee_reported: u64,
        router_source: u8,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(!storage::is_paused(),    E_PAUSED);
        assert!(amount_in > 0,            E_ZERO_AMOUNT);
        assert!(amount_in <= MAX_REPORTED_AMOUNT_IN, E_AMOUNT_TOO_LARGE);
        assert!(storage::is_route_enabled(router_source), E_UNSUPPORTED_ROUTER_SOURCE);

        let user_addr = signer::address_of(user);
        let now = timestamp::now_seconds();

        let (fee_bps, _, _, _, _) = storage::get_partner_config();
        let max_fee = calculate_fee_for_bps(amount_in, fee_bps);
        // Require non-zero fee only when fee is actually collectible after floor math.
        if (fee_bps > 0 && max_fee > 0) {
            assert!(fee_reported > 0, E_INVALID_REPORTED_FEE);
        };
        assert!(fee_reported <= max_fee, E_INVALID_FEE);

        storage::record_global_swap(fee_reported, now);
        storage::record_user_swap(user, amount_in, fee_reported, now);

        event::emit(SwapRecorded {
            user: user_addr,
            router_source,
            amount_in,
            fee_reported,
            net_amount: amount_in - fee_reported,
            timestamp: now,
        });
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// Returns all partner config needed to build a Mosaic API / SDK call.
    ///
    /// Frontend usage:
    ///   const [feeBps, feeRecipient, chargeFeeBy, slippageBps, paused]
    ///     = await router.get_partner_config();
    ///
    ///   const swapData = await getSwapData({
    ///     tokenIn, tokenOut, amountIn,
    ///     feeBps, feeRecipient, chargeFeeBy, slippageBps,
    ///   });
    ///
    /// Returns: (fee_bps, fee_treasury, charge_fee_by, default_slippage_bps, paused)
    #[view]
    public fun get_partner_config(): (u64, address, string::String, u64, bool) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_partner_config()
    }

    #[view]
    public fun get_admin(): address {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_admin()
    }

    #[view]
    public fun get_pending_admin(): address {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_pending_admin()
    }

    #[view]
    public fun is_paused(): bool {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::is_paused()
    }

    /// Calculate the expected partner fee for a given input amount.
    /// Returns: (fee_amount, net_amount)
    #[view]
    public fun calculate_fee(amount_in: u64): (u64, u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let (fee_bps, _, _, _, _) = storage::get_partner_config();
        let fee = calculate_fee_for_bps(amount_in, fee_bps);
        (fee, amount_in - fee)
    }

    /// Returns: (total_swaps, total_fees_reported)
    #[view]
    public fun get_stats(): (u64, u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_stats()
    }

    /// Returns: (total_amount_in, total_fees_reported, swap_count, first_swap_at, last_swap_at)
    #[view]
    public fun get_user_stats(user: address): (u64, u64, u64, u64, u64) {
        storage::get_user_stats(user)
    }

    #[view]
    public fun is_route_enabled(route_id: u8): bool {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::is_route_enabled(route_id)
    }

    #[view]
    public fun get_route_count(): u64 {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_route_count()
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    fun is_valid_charge_fee_by(value: &vector<u8>): bool {
        value == &CHARGE_TOKEN_IN || value == &CHARGE_TOKEN_OUT
    }

    fun calculate_fee_for_bps(amount_in: u64, fee_bps: u64): u64 {
        // Integer division floors fractional fees. Very small amounts may yield fee=0
        // even when fee_bps > 0 (expected behavior for floor-based fee math).
        (amount_in / BPS_DENOMINATOR) * fee_bps
            + ((amount_in % BPS_DENOMINATOR) * fee_bps) / BPS_DENOMINATOR
    }

    // =========================================================================
    // Tests
    // =========================================================================

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::coin;
    #[test_only]
    use aptos_framework::aptos_coin;
    #[test_only]
    use aptos_framework::coin::MintCapability;

    #[test_only]
    fun setup_test(admin: &signer, framework: &signer): MintCapability<aptos_coin::AptosCoin> {
        timestamp::set_time_has_started_for_testing(framework);
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<aptos_coin::AptosCoin>(
            framework,
            std::string::utf8(b"AptosCoin"),
            std::string::utf8(b"APT"),
            8,
            true,
        );
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_freeze_cap(freeze_cap);
        account::create_account_for_test(signer::address_of(admin));
        coin::register<aptos_coin::AptosCoin>(admin);
        mint_cap
    }

    #[test_only]
    fun default_init(admin: &signer) {
        initialize(admin, 30, @0x999, b"token_in", 50);
    }

    // -- Initialization --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_initialize(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        let (fee_bps, treasury, charge_fee_by, slippage, paused) = get_partner_config();
        assert!(fee_bps == 30, 1);
        assert!(treasury == @0x999, 2);
        assert!(charge_fee_by == string::utf8(b"token_in"), 3);
        assert!(slippage == 50, 4);
        assert!(!paused, 5);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_initialize_fee_too_high(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, 600, @0x999, b"token_in", 50);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_TREASURY)]
    public fun test_initialize_invalid_treasury(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, 30, @0x0, b"token_in", 50);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_CHARGE_FEE_BY)]
    public fun test_initialize_invalid_charge_fee_by(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, 30, @0x999, b"invalid_value", 50);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_SLIPPAGE)]
    public fun test_initialize_slippage_too_high(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, 30, @0x999, b"token_in", 6000);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_ALREADY_INITIALIZED)]
    public fun test_double_initialize(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        default_init(admin);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @0xA11CE, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_ADMIN)]
    public fun test_initialize_requires_module_address(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, 30, @0x999, b"token_in", 50);
        coin::destroy_mint_cap(_mc);
    }

    // -- Fee update --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_update_fee(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_fee(admin, 50);
        let (fee_bps, _, _, _, _) = get_partner_config();
        assert!(fee_bps == 50, 1);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_NOT_INITIALIZED)]
    public fun test_update_fee_not_initialized(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        update_fee(admin, 10);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_update_fee_too_high(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_fee(admin, 501);
        coin::destroy_mint_cap(_mc);
    }

    // -- charge_fee_by update --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_update_charge_fee_by(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_charge_fee_by(admin, b"token_out");
        let (_, _, charge_fee_by, _, _) = get_partner_config();
        assert!(charge_fee_by == string::utf8(b"token_out"), 1);
        update_charge_fee_by(admin, b"token_in");
        let (_, _, charge_fee_by2, _, _) = get_partner_config();
        assert!(charge_fee_by2 == string::utf8(b"token_in"), 2);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_CHARGE_FEE_BY)]
    public fun test_update_charge_fee_by_invalid(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_charge_fee_by(admin, b"bad_value");
        coin::destroy_mint_cap(_mc);
    }

    // -- Slippage update --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_update_slippage(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_default_slippage(admin, 100);
        let (_, _, _, slippage, _) = get_partner_config();
        assert!(slippage == 100, 1);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_SLIPPAGE)]
    public fun test_update_slippage_too_high(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_default_slippage(admin, 5001);
        coin::destroy_mint_cap(_mc);
    }

    // -- Pause --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_pause_unpause(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        assert!(!is_paused(), 1);
        set_paused(admin, true);
        assert!(is_paused(), 2);
        set_paused(admin, false);
        assert!(!is_paused(), 3);
        coin::destroy_mint_cap(_mc);
    }

    // -- Admin transfer --

    #[test(admin = @swap_router, new_admin = @0xBEEF, framework = @0x1)]
    public fun test_admin_transfer(admin: &signer, new_admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(new_admin));
        default_init(admin);
        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);
        accept_admin(new_admin);
        assert!(get_admin() == @0xBEEF, 2);
        assert!(get_pending_admin() == @0x0, 3);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_cancel_admin_transfer(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);
        cancel_admin_transfer(admin);
        assert!(get_pending_admin() == @0x0, 2);
        coin::destroy_mint_cap(_mc);
    }

    // -- Fee calculation --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_calculate_fee(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin); // 0.3%
        let (fee, net) = calculate_fee(10000);
        assert!(fee == 30, 1);
        assert!(net == 9970, 2);
        let (fee2, net2) = calculate_fee(100000000);
        assert!(fee2 == 300000, 3);
        assert!(net2 == 99700000, 4);
        coin::destroy_mint_cap(_mc);
    }

    // -- Route management --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_mosaic_route_seeded_on_init(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        assert!(is_route_enabled(1u8), 1);
        assert!(get_route_count() == 1, 2);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_add_route(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        add_route(admin, 2u8, b"pancakeswap");
        assert!(get_route_count() == 2, 1);
        assert!(is_route_enabled(2u8), 2);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = 401, location = swap_router::storage)]
    public fun test_add_route_duplicate_fails(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        add_route(admin, 1u8, b"duplicate");
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_set_route_enabled_toggle(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        assert!(is_route_enabled(1u8), 1);
        set_route_enabled(admin, 1u8, false);
        assert!(!is_route_enabled(1u8), 2);
        set_route_enabled(admin, 1u8, true);
        assert!(is_route_enabled(1u8), 3);
        coin::destroy_mint_cap(_mc);
    }

    // -- record_swap --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_record_swap(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        record_swap(admin, 100_000_000, 30_000, ROUTER_MOSAIC);
        let (total_swaps, total_fees) = get_stats();
        assert!(total_swaps == 1, 1);
        assert!(total_fees == 30_000, 2);
        let (amount_in, fees, count, _, _) = get_user_stats(@swap_router);
        assert!(count == 1, 3);
        assert!(amount_in == 100_000_000, 4);
        assert!(fees == 30_000, 5);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_record_swap_accumulates(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        record_swap(admin, 100_000_000, 30_000, ROUTER_MOSAIC);
        record_swap(admin, 200_000_000, 60_000, ROUTER_MOSAIC);
        let (_, fees) = get_stats();
        assert!(fees == 90_000, 1);
        let (amount_in, _, count, _, _) = get_user_stats(@swap_router);
        assert!(count == 2, 2);
        assert!(amount_in == 300_000_000, 3);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_PAUSED)]
    public fun test_record_swap_paused(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        set_paused(admin, true);
        record_swap(admin, 100_000_000, 30_000, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_ZERO_AMOUNT)]
    public fun test_record_swap_zero_amount(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        record_swap(admin, 0, 0, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_UNSUPPORTED_ROUTER_SOURCE)]
    public fun test_record_swap_unknown_route(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        record_swap(admin, 100_000_000, 30_000, 9u8);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_UNSUPPORTED_ROUTER_SOURCE)]
    public fun test_record_swap_disabled_route(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        set_route_enabled(admin, 1u8, false);
        record_swap(admin, 100_000_000, 30_000, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_record_swap_fee_above_configured_limit_fails(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        // At 30 bps on amount 1000, max allowed reported fee is 3.
        record_swap(admin, 1000, 9999, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_REPORTED_FEE)]
    public fun test_record_swap_zero_reported_fee_fails_when_fee_enabled(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        record_swap(admin, 1000, 0, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_record_swap_zero_reported_fee_allowed_when_max_fee_zero(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        // At 30 bps on amount 1, floor-based max fee is 0.
        record_swap(admin, 1, 0, ROUTER_MOSAIC);
        let (total_swaps, total_fees) = get_stats();
        assert!(total_swaps == 1, 1);
        assert!(total_fees == 0, 2);
        coin::destroy_mint_cap(_mc);
    }

    #[test]
    public fun test_user_stats_zero_for_new_address() {
        let (a, b, c, d, e) = get_user_stats(@0xDEAD);
        assert!(a == 0, 1);
        assert!(b == 0, 2);
        assert!(c == 0, 3);
        assert!(d == 0, 4);
        assert!(e == 0, 5);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_INITIALIZED)]
    public fun test_get_partner_config_not_initialized() {
        get_partner_config();
    }
}