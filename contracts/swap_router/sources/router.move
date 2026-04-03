/// =============================================================================
/// Movement Network Swap Router — Logic Module
/// =============================================================================
///
/// Business logic only. All persistent state lives in swap_router::storage.
/// This module can be upgraded or replaced at any time without touching stored
/// data — swap history, fees, admin, treasury, per-user stats all survive.
///
/// To ship a new feature that needs a logic change:
///   1. Write router_v2.move with your new logic
///   2. Add `friend swap_router::router_v2;` to storage.move (one line)
///   3. Publish storage.move (compatible upgrade), then publish router_v2.move
///   → All user data intact.
///
/// Error codes (1xx = auth, 2xx = validation, 3xx = state):
///   100 - E_NOT_ADMIN
///   101 - E_NOT_PENDING_ADMIN
///   102 - E_INVALID_ADMIN
///   200 - E_INVALID_FEE
///   201 - E_ZERO_AMOUNT
///   204 - E_UNSUPPORTED_ROUTER_SOURCE
///   205 - E_INVALID_TREASURY
///   300 - E_PAUSED
///   301 - E_ALREADY_INITIALIZED
///   302 - E_NOT_INITIALIZED
/// =============================================================================

module swap_router::router {
    use std::signer;
    use aptos_framework::coin;
    use aptos_framework::account;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use swap_router::storage;

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    const E_NOT_ADMIN: u64 = 100;
    const E_NOT_PENDING_ADMIN: u64 = 101;
    const E_INVALID_ADMIN: u64 = 102;
    const E_INVALID_FEE: u64 = 200;
    const E_ZERO_AMOUNT: u64 = 201;
    const E_UNSUPPORTED_ROUTER_SOURCE: u64 = 204;
    const E_INVALID_TREASURY: u64 = 205;
    const E_PAUSED: u64 = 300;
    const E_ALREADY_INITIALIZED: u64 = 301;
    const E_NOT_INITIALIZED: u64 = 302;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// Maximum protocol fee: 5% = 500 bps
    const MAX_FEE_BPS: u64 = 500;

    /// Fee denominator (10_000 = 100%)
    const BPS_DENOMINATOR: u64 = 10000;

    /// Stable route IDs — never reuse a deactivated ID across deployments.
    /// New routes are registered on-chain via add_route(); these constants
    /// are just convenience aliases used in this logic module.
    const ROUTER_MOSAIC: u8 = 1;
    // const ROUTER_PANCAKE: u8 = 2;   // add when pancakeswap route ships
    // const ROUTER_CELLANA: u8 = 3;   // add when cellana route ships

    // -------------------------------------------------------------------------
    // Events — emitted here in logic module, storage is state-only
    // -------------------------------------------------------------------------

    #[event]
    struct SwapExecuted has drop, store {
        user: address,
        router_source: u8,
        amount_in: u64,
        fee_amount: u64,
        net_amount: u64,
        timestamp: u64,
    }

    #[event]
    struct FeeCollected has drop, store {
        treasury: address,
        amount: u64,
        cumulative_total: u64,
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
    /// Delegates storage creation to swap_router::storage.
    public entry fun initialize(
        admin: &signer,
        fee_bps: u64,
        fee_treasury: address,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @swap_router, E_INVALID_ADMIN);
        assert!(!storage::config_exists(), E_ALREADY_INITIALIZED);
        assert!(fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);
        assert!(fee_treasury != @0x0, E_INVALID_TREASURY);

        let now = timestamp::now_seconds();
        storage::init_config(admin, fee_bps, fee_treasury, now);

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
    public entry fun transfer_admin(
        admin: &signer,
        new_admin: address,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let current_admin = storage::get_admin();
        assert!(signer::address_of(admin) == current_admin, E_NOT_ADMIN);
        assert!(new_admin != @0x0, E_INVALID_ADMIN);
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
    public entry fun accept_admin(
        new_admin: &signer,
    ) {
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
    public entry fun cancel_admin_transfer(
        admin: &signer,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        storage::set_pending_admin(@0x0, timestamp::now_seconds());
    }

    // -------------------------------------------------------------------------
    // Fee & config management
    // -------------------------------------------------------------------------

    /// Update the protocol fee (admin only, max 500 bps = 5%).
    public entry fun update_fee(
        admin: &signer,
        new_fee_bps: u64,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == storage::get_admin(), E_NOT_ADMIN);
        assert!(new_fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);

        let now = timestamp::now_seconds();
        storage::set_fee_bps(new_fee_bps, now);

        event::emit(ConfigUpdated {
            admin: admin_addr,
            field: b"fee_bps",
            timestamp: now,
        });
    }

    /// Update the treasury address (admin only).
    public entry fun update_treasury(
        admin: &signer,
        new_treasury: address,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == storage::get_admin(), E_NOT_ADMIN);
        assert!(new_treasury != @0x0, E_INVALID_TREASURY);

        let now = timestamp::now_seconds();
        storage::set_fee_treasury(new_treasury, now);

        event::emit(ConfigUpdated {
            admin: admin_addr,
            field: b"fee_treasury",
            timestamp: now,
        });
    }

    /// Emergency pause: halts all swap operations (admin only).
    public entry fun set_paused(
        admin: &signer,
        is_paused: bool,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == storage::get_admin(), E_NOT_ADMIN);

        let now = timestamp::now_seconds();
        storage::set_paused(is_paused, now);

        event::emit(ConfigUpdated {
            admin: admin_addr,
            field: if (is_paused) { b"paused" } else { b"unpaused" },
            timestamp: now,
        });
    }

    // -------------------------------------------------------------------------
    // Route management
    // -------------------------------------------------------------------------

    /// Register a new swap route (admin only).
    /// route_id must be unique — pick the next unused integer.
    /// name is a human-readable label e.g. b"pancakeswap".
    public entry fun add_route(
        admin: &signer,
        route_id: u8,
        name: vector<u8>,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);

        let now = timestamp::now_seconds();
        storage::add_route(route_id, name, now);

        event::emit(RouteUpdated { route_id, enabled: true, timestamp: now });
    }

    /// Enable or disable an existing route (admin only).
    /// Disabling blocks new swaps through that route without deleting it.
    public entry fun set_route_enabled(
        admin: &signer,
        route_id: u8,
        enabled: bool,
    ) {
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
    // Swap with fee collection
    // -------------------------------------------------------------------------

    /// Collect protocol fee from CoinIn before the aggregator swap executes.
    ///
    /// Flow:
    ///   1. Frontend gets quote from Mosaic API
    ///   2. Frontend calls collect_fee to deduct protocol fee
    ///   3. Frontend submits the aggregator swap tx (separate transaction)
    public entry fun collect_fee<CoinIn>(
        user: &signer,
        amount_in: u64,
        router_source: u8,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);

        // Read all required state in one call
        let (fee_bps, fee_treasury, total_fees_before, _swaps, paused) = storage::get_all();

        assert!(!paused, E_PAUSED);
        assert!(amount_in > 0, E_ZERO_AMOUNT);
        // Dynamic route check — validates against the on-chain RouteRegistry
        assert!(storage::is_route_enabled(router_source), E_UNSUPPORTED_ROUTER_SOURCE);

        let user_addr = signer::address_of(user);
        let now = timestamp::now_seconds();

        // Overflow-safe fee: split to avoid u64 overflow on large amounts
        let fee_amount = (amount_in / BPS_DENOMINATOR) * fee_bps
            + ((amount_in % BPS_DENOMINATOR) * fee_bps) / BPS_DENOMINATOR;
        let fee_to_record: u64 = 0;

        if (fee_amount > 0) {
            let fee_coins = coin::withdraw<CoinIn>(user, fee_amount);

            if (!account::exists_at(fee_treasury)) {
                // Treasury account doesn't exist — return fee to user
                coin::deposit(user_addr, fee_coins);
            } else if (!coin::is_account_registered<CoinIn>(fee_treasury)) {
                // Treasury not registered for this coin — return fee to user
                coin::deposit(user_addr, fee_coins);
            } else {
                coin::deposit(fee_treasury, fee_coins);
                fee_to_record = fee_amount;

                event::emit(FeeCollected {
                    treasury: fee_treasury,
                    amount: fee_amount,
                    cumulative_total: total_fees_before + fee_amount,
                    timestamp: now,
                });
            };
        };

        // Persist global counters + per-user lifetime stats
        storage::record_global_swap(fee_to_record, now);
        storage::record_user_swap(user, amount_in, fee_to_record, now);

        event::emit(SwapExecuted {
            user: user_addr,
            router_source,
            amount_in,
            fee_amount: fee_to_record,
            net_amount: amount_in - fee_to_record,
            timestamp: now,
        });
    }

    /// Admin utility: verify treasury is set up correctly before enabling swaps.
    public entry fun register_treasury_coin<CoinType>(
        admin: &signer,
    ) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        assert!(signer::address_of(admin) == storage::get_admin(), E_NOT_ADMIN);
        // Validates admin access; treasury must call coin::register themselves.
    }

    // -------------------------------------------------------------------------
    // View functions — thin wrappers over storage getters
    // -------------------------------------------------------------------------

    /// Get current fee configuration.
    /// Returns: (fee_bps, treasury, total_fees_collected, total_swaps, paused)
    #[view]
    public fun get_config(): (u64, address, u64, u64, bool) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_all()
    }

    /// Get the current admin address.
    #[view]
    public fun get_admin(): address {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_admin()
    }

    /// Get the pending admin address (0x0 if none).
    #[view]
    public fun get_pending_admin(): address {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_pending_admin()
    }

    /// Check if the router is paused.
    #[view]
    public fun is_paused(): bool {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::is_paused()
    }

    /// Calculate the protocol fee for a given input amount.
    /// Returns: (fee_amount, net_amount)
    #[view]
    public fun calculate_fee(amount_in: u64): (u64, u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        let (fee_bps, _, _, _, _) = storage::get_all();
        // Overflow-safe fee: split to avoid u64 overflow on large amounts
        let fee = (amount_in / BPS_DENOMINATOR) * fee_bps
            + ((amount_in % BPS_DENOMINATOR) * fee_bps) / BPS_DENOMINATOR;
        (fee, amount_in - fee)
    }

    /// Get total swap statistics.
    /// Returns: (total_swaps, total_fees_collected)
    #[view]
    public fun get_stats(): (u64, u64) {
        assert!(storage::config_exists(), E_NOT_INITIALIZED);
        storage::get_stats()
    }

    /// Get lifetime swap stats for a specific user.
    /// Returns: (total_amount_in, total_fees_paid, swap_count, first_swap_at, last_swap_at)
    /// Returns all zeros if the user has never swapped.
    #[view]
    public fun get_user_stats(user: address): (u64, u64, u64, u64, u64) {
        storage::get_user_stats(user)
    }

    /// Check if a swap route is currently enabled.
    #[view]
    public fun is_route_enabled(route_id: u8): bool {
        storage::is_route_enabled(route_id)
    }

    /// Total number of routes ever registered.
    #[view]
    public fun get_route_count(): u64 {
        storage::get_route_count()
    }

    // =========================================================================
    // Tests
    // =========================================================================

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

    // -- Initialization tests --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_initialize(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);

        initialize(admin, 30, @0x999);

        let (fee_bps, treasury, total_fees, total_swaps, paused) = get_config();
        assert!(fee_bps == 30, 1);
        assert!(treasury == @0x999, 2);
        assert!(total_fees == 0, 3);
        assert!(total_swaps == 0, 4);
        assert!(!paused, 5);

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_initialize_fee_too_high(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 600, @0x999); // 6% > 5% max
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_TREASURY)]
    public fun test_initialize_invalid_treasury(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x0);
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_ALREADY_INITIALIZED)]
    public fun test_double_initialize(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);
        initialize(admin, 50, @0x999); // Should fail
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @0xA11CE, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_ADMIN)]
    public fun test_initialize_requires_module_address(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);
        coin::destroy_mint_cap(_mint_cap);
    }

    // -- Fee update tests --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_update_fee(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        update_fee(admin, 50);
        let (fee_bps, _, _, _, _) = get_config();
        assert!(fee_bps == 50, 1);

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_NOT_INITIALIZED)]
    public fun test_update_fee_not_initialized(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        update_fee(admin, 10);
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_update_fee_too_high(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);
        update_fee(admin, 501); // > 500 bps
        coin::destroy_mint_cap(_mint_cap);
    }

    // -- Pause tests --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_pause_unpause(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        assert!(!is_paused(), 1);

        set_paused(admin, true);
        assert!(is_paused(), 2);

        set_paused(admin, false);
        assert!(!is_paused(), 3);

        coin::destroy_mint_cap(_mint_cap);
    }

    // -- Admin transfer tests --

    #[test(admin = @swap_router, new_admin = @0xBEEF, framework = @0x1)]
    public fun test_admin_transfer(admin: &signer, new_admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(new_admin));

        initialize(admin, 30, @0x999);

        // Step 1: nominate
        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);

        // Step 2: accept
        accept_admin(new_admin);
        assert!(get_admin() == @0xBEEF, 2);
        assert!(get_pending_admin() == @0x0, 3);

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_cancel_admin_transfer(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);

        cancel_admin_transfer(admin);
        assert!(get_pending_admin() == @0x0, 2);

        coin::destroy_mint_cap(_mint_cap);
    }

    // -- Fee calculation tests --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_calculate_fee(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999); // 0.3%

        let (fee, net) = calculate_fee(10000);
        assert!(fee == 30, 1);   // 10000 * 30 / 10000 = 30
        assert!(net == 9970, 2); // 10000 - 30

        let (fee2, net2) = calculate_fee(100000000); // 1 MOVE
        assert!(fee2 == 300000, 3);    // 0.003 MOVE
        assert!(net2 == 99700000, 4);  // 0.997 MOVE

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_INITIALIZED)]
    public fun test_get_config_not_initialized() {
        get_config();
    }

    // -- Collect fee tests --

    #[test(admin = @swap_router, treasury = @0x999, framework = @0x1)]
    public fun test_collect_fee(admin: &signer, treasury: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);

        // Setup treasury
        account::create_account_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(treasury);

        initialize(admin, 100, @0x999); // 1% fee

        // Mint coins for admin (acting as user)
        let coins = coin::mint(100000000, &mint_cap); // 1 MOVE
        coin::deposit(@swap_router, coins);

        // Collect fee
        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, ROUTER_MOSAIC);

        // Verify stats
        let (total_swaps, total_fees) = get_stats();
        assert!(total_swaps == 1, 1);
        assert!(total_fees == 1000000, 2); // 1% of 1 MOVE = 0.01 MOVE

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_PAUSED)]
    public fun test_collect_fee_when_paused(admin: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);
        set_paused(admin, true);

        let coins = coin::mint(100000000, &mint_cap);
        coin::deposit(@swap_router, coins);

        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, ROUTER_MOSAIC);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = E_ZERO_AMOUNT)]
    public fun test_collect_fee_zero_amount(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        collect_fee<aptos_coin::AptosCoin>(admin, 0, ROUTER_MOSAIC);
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, treasury = @0x999, framework = @0x1)]
    #[expected_failure(abort_code = E_UNSUPPORTED_ROUTER_SOURCE)]
    public fun test_collect_fee_invalid_router_source(admin: &signer, treasury: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(treasury);

        initialize(admin, 100, @0x999);

        let coins = coin::mint(100000000, &mint_cap);
        coin::deposit(@swap_router, coins);

        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, 9);
        coin::destroy_mint_cap(mint_cap);
    }

    // -- RouteRegistry tests --

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_mosaic_route_seeded_on_init(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        // Mosaic (route_id = 1) is pre-seeded by storage::init_config
        assert!(is_route_enabled(1u8), 1);
        assert!(get_route_count() == 1, 2);

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_add_route(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        assert!(get_route_count() == 1, 1);
        add_route(admin, 2u8, b"pancakeswap");
        assert!(get_route_count() == 2, 2);
        assert!(is_route_enabled(2u8), 3);

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    #[expected_failure(abort_code = 401, location = swap_router::storage)] // E_ROUTE_ALREADY_EXISTS from storage
    public fun test_add_route_duplicate_fails(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        // route_id = 1 is already seeded for Mosaic — duplicate should abort
        add_route(admin, 1u8, b"duplicate");
        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_set_route_enabled_toggle(admin: &signer, framework: &signer) {
        let _mint_cap = setup_test(admin, framework);
        initialize(admin, 30, @0x999);

        assert!(is_route_enabled(1u8), 1);  // Mosaic starts enabled

        set_route_enabled(admin, 1u8, false);
        assert!(!is_route_enabled(1u8), 2); // now disabled

        set_route_enabled(admin, 1u8, true);
        assert!(is_route_enabled(1u8), 3);  // re-enabled

        coin::destroy_mint_cap(_mint_cap);
    }

    #[test(admin = @swap_router, treasury = @0x999, framework = @0x1)]
    #[expected_failure(abort_code = E_UNSUPPORTED_ROUTER_SOURCE)]
    public fun test_collect_fee_disabled_route(admin: &signer, treasury: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(treasury);
        initialize(admin, 100, @0x999);

        // Disable Mosaic route — collect_fee should abort before coin withdrawal
        set_route_enabled(admin, 1u8, false);
        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, 1u8);
        coin::destroy_mint_cap(mint_cap);
    }

    // -- UserSwapStats tests --

    #[test(admin = @swap_router, treasury = @0x999, framework = @0x1)]
    public fun test_user_stats_after_first_swap(admin: &signer, treasury: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(treasury);
        initialize(admin, 100, @0x999); // 1% fee

        let coins = coin::mint(100000000, &mint_cap); // 1 MOVE
        coin::deposit(@swap_router, coins);
        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, ROUTER_MOSAIC);

        let (amount_in, fees_paid, count, _, _) = get_user_stats(@swap_router);
        assert!(count == 1, 1);
        assert!(amount_in == 100000000, 2);
        assert!(fees_paid == 1000000, 3); // 1% of 1 MOVE = 0.01 MOVE

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, treasury = @0x999, framework = @0x1)]
    public fun test_user_stats_accumulate(admin: &signer, treasury: &signer, framework: &signer) {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(treasury);
        initialize(admin, 100, @0x999); // 1% fee

        // First swap: 1 MOVE
        let coins = coin::mint(100000000, &mint_cap);
        coin::deposit(@swap_router, coins);
        collect_fee<aptos_coin::AptosCoin>(admin, 100000000, ROUTER_MOSAIC);

        // Second swap: 2 MOVE
        let coins2 = coin::mint(200000000, &mint_cap);
        coin::deposit(@swap_router, coins2);
        collect_fee<aptos_coin::AptosCoin>(admin, 200000000, ROUTER_MOSAIC);

        let (amount_in, fees_paid, count, _, _) = get_user_stats(@swap_router);
        assert!(count == 2, 1);
        assert!(amount_in == 300000000, 2); // 1 + 2 MOVE
        assert!(fees_paid == 3000000, 3);   // 1% of 3 MOVE = 0.03 MOVE

        coin::destroy_mint_cap(mint_cap);
    }

    #[test]
    public fun test_user_stats_zero_for_new_user() {
        let (amount_in, fees_paid, count, first_at, last_at) = get_user_stats(@0xDEAD);
        assert!(amount_in == 0, 1);
        assert!(fees_paid == 0, 2);
        assert!(count == 0, 3);
        assert!(first_at == 0, 4);
        assert!(last_at == 0, 5);
    }
}
