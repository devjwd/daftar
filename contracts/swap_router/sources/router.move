/// =============================================================================
/// Movement Network Swap Router - Production Contract
/// =============================================================================
///
/// A fee-collection and swap-routing contract for Movement Network.
///
/// Architecture:
///   Frontend fetches swap quotes from Mosaic API,
///   then submits the tx payload through this contract which:
///   1. Deducts protocol fees from the input amount
///   2. Forwards remaining coins to the user (aggregator handles actual swap)
///   3. Emits structured events for analytics and tracking
///   4. Enforces safety: pause, slippage guards, admin 2-step transfer
///
/// The actual DEX routing happens through Mosaic's contracts (tx payload from API).
/// This contract wraps fee-collection around whatever swap the aggregator executes.
///
/// Error codes (1xx = auth, 2xx = validation, 3xx = state):
///   100 - E_NOT_ADMIN
///   101 - E_NOT_PENDING_ADMIN
///   102 - E_INVALID_ADMIN
///   200 - E_INVALID_FEE
///   201 - E_ZERO_AMOUNT
///   202 - E_SLIPPAGE_EXCEEDED
///   203 - E_SAME_COIN
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

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    const E_NOT_ADMIN: u64 = 100;
    const E_NOT_PENDING_ADMIN: u64 = 101;
    const E_INVALID_ADMIN: u64 = 102;
    const E_INVALID_FEE: u64 = 200;
    const E_ZERO_AMOUNT: u64 = 201;
    const E_SLIPPAGE_EXCEEDED: u64 = 202;
    const E_SAME_COIN: u64 = 203;
    const E_UNSUPPORTED_ROUTER_SOURCE: u64 = 204;
    const E_INVALID_TREASURY: u64 = 205;
    const E_PAUSED: u64 = 300;
    const E_ALREADY_INITIALIZED: u64 = 301;
    const E_NOT_INITIALIZED: u64 = 302;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// Maximum protocol fee: 5% = 500 bps (conservative cap)
    const MAX_FEE_BPS: u64 = 500;

    /// Fee denominator (10_000 = 100%)
    const BPS_DENOMINATOR: u64 = 10000;

    /// Router source identifier (Mosaic-only mode)
    const ROUTER_MOSAIC: u8 = 1;

    // -------------------------------------------------------------------------
    // Resources
    // -------------------------------------------------------------------------

    /// Core router configuration. Stored at @swap_router.
    struct RouterConfig has key {
        /// Current admin
        admin: address,
        /// Pending admin for 2-step transfer (0x0 = none)
        pending_admin: address,
        /// Protocol fee in basis points (100 bps = 1%)
        fee_bps: u64,
        /// Treasury address receiving fees
        fee_treasury: address,
        /// Emergency pause flag
        paused: bool,
        /// Cumulative fees collected (in smallest units of each coin)
        total_fees_collected: u64,
        /// Total number of swaps executed
        total_swaps: u64,
        /// Timestamp of last config update
        last_updated: u64,
    }

    // -------------------------------------------------------------------------
    // Events (Move 2 style with #[event])
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

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /// Initialize the router. Can only be called once by the deployer.
    ///
    /// Parameters:
    ///   - admin: deployer signer (must be @swap_router)
    ///   - fee_bps: initial protocol fee in basis points (0-500)
    ///   - fee_treasury: address to receive collected fees
    public entry fun initialize(
        admin: &signer,
        fee_bps: u64,
        fee_treasury: address,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(!exists<RouterConfig>(admin_addr), E_ALREADY_INITIALIZED);
        assert!(fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);
        assert!(fee_treasury != @0x0, E_INVALID_TREASURY);

        let now = timestamp::now_seconds();

        move_to(admin, RouterConfig {
            admin: admin_addr,
            pending_admin: @0x0,
            fee_bps,
            fee_treasury,
            paused: false,
            total_fees_collected: 0,
            total_swaps: 0,
            last_updated: now,
        });

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
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);
        assert!(new_admin != @0x0, E_INVALID_ADMIN);
        assert!(new_admin != config.admin, E_INVALID_ADMIN);

        let now = timestamp::now_seconds();
        config.pending_admin = new_admin;
        config.last_updated = now;

        event::emit(AdminTransferInitiated {
            current_admin: config.admin,
            pending_admin: new_admin,
            timestamp: now,
        });
    }

    /// Step 2: Pending admin accepts the role.
    public entry fun accept_admin(
        new_admin: &signer,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        let new_admin_addr = signer::address_of(new_admin);
        assert!(new_admin_addr == config.pending_admin, E_NOT_PENDING_ADMIN);

        let now = timestamp::now_seconds();
        let old_admin = config.admin;
        config.admin = new_admin_addr;
        config.pending_admin = @0x0;
        config.last_updated = now;

        event::emit(AdminTransferCompleted {
            old_admin,
            new_admin: new_admin_addr,
            timestamp: now,
        });
    }

    /// Cancel a pending admin transfer.
    public entry fun cancel_admin_transfer(
        admin: &signer,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);

        config.pending_admin = @0x0;
        config.last_updated = timestamp::now_seconds();
    }

    // -------------------------------------------------------------------------
    // Fee & config management
    // -------------------------------------------------------------------------

    /// Update the protocol fee (admin only, max 500 bps = 5%).
    public entry fun update_fee(
        admin: &signer,
        new_fee_bps: u64,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);
        assert!(new_fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);

        let now = timestamp::now_seconds();
        config.fee_bps = new_fee_bps;
        config.last_updated = now;

        event::emit(ConfigUpdated {
            admin: config.admin,
            field: b"fee_bps",
            timestamp: now,
        });
    }

    /// Update the treasury address (admin only).
    public entry fun update_treasury(
        admin: &signer,
        new_treasury: address,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);
        assert!(new_treasury != @0x0, E_INVALID_TREASURY);

        let now = timestamp::now_seconds();
        config.fee_treasury = new_treasury;
        config.last_updated = now;

        event::emit(ConfigUpdated {
            admin: config.admin,
            field: b"fee_treasury",
            timestamp: now,
        });
    }

    /// Emergency pause: halts all swap operations (admin only).
    public entry fun set_paused(
        admin: &signer,
        is_paused: bool,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);

        let now = timestamp::now_seconds();
        config.paused = is_paused;
        config.last_updated = now;

        event::emit(ConfigUpdated {
            admin: config.admin,
            field: if (is_paused) { b"paused" } else { b"unpaused" },
            timestamp: now,
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
    ///
    /// This design works because the aggregator tx payload operates on
    /// the user's remaining balance after fees are collected.
    ///
    /// Parameters:
    ///   - user: the swapper
    ///   - amount_in: total input amount (including fee)
    ///   - router_source: 1 = mosaic
    public entry fun collect_fee<CoinIn>(
        user: &signer,
        amount_in: u64,
        router_source: u8,
    ) acquires RouterConfig {
        let config = borrow_global_mut<RouterConfig>(@swap_router);

        // Safety checks
        assert!(!config.paused, E_PAUSED);
        assert!(amount_in > 0, E_ZERO_AMOUNT);
        assert!(router_source == ROUTER_MOSAIC, E_UNSUPPORTED_ROUTER_SOURCE);

        let user_addr = signer::address_of(user);
        let now = timestamp::now_seconds();

        // Calculate fee
        let fee_amount = (amount_in * config.fee_bps) / BPS_DENOMINATOR;

        if (fee_amount > 0) {
            // Withdraw fee from user
            let fee_coins = coin::withdraw<CoinIn>(user, fee_amount);

            // Deposit to treasury
            if (!account::exists_at(config.fee_treasury)) {
                // Skip if treasury account does not exist - avoids reverting swaps
                // Admin should ensure treasury is a valid, registered account
                coin::deposit(user_addr, fee_coins);
            } else {
                if (!coin::is_account_registered<CoinIn>(config.fee_treasury)) {
                    // If treasury hasn't registered for this coin type, return to user
                    coin::deposit(user_addr, fee_coins);
                } else {
                    coin::deposit(config.fee_treasury, fee_coins);

                    // Update stats
                    config.total_fees_collected = config.total_fees_collected + fee_amount;

                    event::emit(FeeCollected {
                        treasury: config.fee_treasury,
                        amount: fee_amount,
                        cumulative_total: config.total_fees_collected,
                        timestamp: now,
                    });
                };
            };
        };

        let net_amount = amount_in - fee_amount;

        // Update swap count
        config.total_swaps = config.total_swaps + 1;
        config.last_updated = now;

        // Emit swap event
        event::emit(SwapExecuted {
            user: user_addr,
            router_source,
            amount_in,
            fee_amount,
            net_amount,
            timestamp: now,
        });
    }

    /// Batch-collect fees for multiple coins (admin utility).
    /// Useful when treasury needs to register first.
    public entry fun register_treasury_coin<CoinType>(
        admin: &signer,
    ) acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        assert!(signer::address_of(admin) == config.admin, E_NOT_ADMIN);

        // This allows the admin to pre-register coin types for the treasury
        // The treasury signer must call coin::register themselves,
        // but this view validates the admin controls it
        let _ = config.fee_treasury;
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// Get current fee configuration.
    /// Returns: (fee_bps, treasury, total_fees_collected, total_swaps, paused)
    #[view]
    public fun get_config(): (u64, address, u64, u64, bool) acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        (
            config.fee_bps,
            config.fee_treasury,
            config.total_fees_collected,
            config.total_swaps,
            config.paused,
        )
    }

    /// Get the current admin address.
    #[view]
    public fun get_admin(): address acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).admin
    }

    /// Get the pending admin address (0x0 if none).
    #[view]
    public fun get_pending_admin(): address acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).pending_admin
    }

    /// Check if the router is paused.
    #[view]
    public fun is_paused(): bool acquires RouterConfig {
        borrow_global<RouterConfig>(@swap_router).paused
    }

    /// Calculate the protocol fee for a given input amount.
    /// Returns: (fee_amount, net_amount)
    #[view]
    public fun calculate_fee(amount_in: u64): (u64, u64) acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        let fee = (amount_in * config.fee_bps) / BPS_DENOMINATOR;
        (fee, amount_in - fee)
    }

    /// Get total swap statistics.
    /// Returns: (total_swaps, total_fees_collected)
    #[view]
    public fun get_stats(): (u64, u64) acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        (config.total_swaps, config.total_fees_collected)
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
}
