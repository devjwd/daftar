module swap_router::router {
    use std::signer;
    use std::vector;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_INVALID_FEE: u64 = 2;
    const E_ZERO_AMOUNT: u64 = 3;
    const E_SLIPPAGE_EXCEEDED: u64 = 4;
    const E_INVALID_ROUTER: u64 = 5;

    /// Maximum fee in basis points (10% = 1000 bps)
    const MAX_FEE_BPS: u64 = 1000;

    /// Router types
    const ROUTER_MOSAIC: u8 = 1;
    const ROUTER_YUZU: u8 = 2;

    /// Router configuration and fee management
    struct RouterConfig has key {
        /// Admin address for fee management
        admin: address,
        /// Fee in basis points (100 bps = 1%)
        fee_bps: u64,
        /// Fee treasury address
        fee_treasury: address,
        /// Total fees collected
        total_fees_collected: u64,
        /// Swap events
        swap_events: EventHandle<SwapEvent>,
    }

    /// Event emitted on each swap
    struct SwapEvent has drop, store {
        user: address,
        router_type: u8,
        src_coin: vector<u8>,
        dst_coin: vector<u8>,
        amount_in: u64,
        amount_out: u64,
        fee_collected: u64,
    }

    /// Initialize the router module
    public entry fun initialize(
        admin: &signer,
        fee_bps: u64,
        fee_treasury: address,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);
        
        move_to(admin, RouterConfig {
            admin: admin_addr,
            fee_bps,
            fee_treasury,
            total_fees_collected: 0,
            swap_events: account::new_event_handle<SwapEvent>(admin),
        });
    }

    /// Update fee configuration (admin only)
    public entry fun update_fee(
        admin: &signer,
        new_fee_bps: u64,
    ) acquires RouterConfig {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(admin_addr == config.admin, E_NOT_ADMIN);
        assert!(new_fee_bps <= MAX_FEE_BPS, E_INVALID_FEE);
        
        config.fee_bps = new_fee_bps;
    }

    /// Update fee treasury (admin only)
    public entry fun update_treasury(
        admin: &signer,
        new_treasury: address,
    ) acquires RouterConfig {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        assert!(admin_addr == config.admin, E_NOT_ADMIN);
        
        config.fee_treasury = new_treasury;
    }

    /// Swap coins via Mosaic router
    /// This is a wrapper that collects fees before routing to Mosaic
    public entry fun swap_via_mosaic<CoinIn, CoinOut>(
        user: &signer,
        amount_in: u64,
        amount_out_min: u64,
    ) acquires RouterConfig {
        assert!(amount_in > 0, E_ZERO_AMOUNT);
        let user_addr = signer::address_of(user);
        
        // Get config
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        
        // Calculate fee
        let fee_amount = (amount_in * config.fee_bps) / 10000;
        let swap_amount = amount_in - fee_amount;
        
        // Withdraw from user
        let coins_in = coin::withdraw<CoinIn>(user, amount_in);
        
        // Split fee
        let fee_coins = coin::extract(&mut coins_in, fee_amount);
        
        // Deposit fee to treasury
        if (!account::exists_at(config.fee_treasury)) {
            account::create_account(config.fee_treasury);
        };
        coin::deposit(config.fee_treasury, fee_coins);
        config.total_fees_collected = config.total_fees_collected + fee_amount;
        
        // Note: In production, this would call the actual Mosaic router
        // For now, we'll do a direct swap simulation
        // The frontend will handle the actual Mosaic API call
        
        // Deposit remaining coins back (in production, this would be the swap output)
        coin::deposit(user_addr, coins_in);
        
        // Emit event
        event::emit_event(&mut config.swap_events, SwapEvent {
            user: user_addr,
            router_type: ROUTER_MOSAIC,
            src_coin: b"CoinIn",
            dst_coin: b"CoinOut",
            amount_in,
            amount_out: swap_amount, // In production, this would be actual output
            fee_collected: fee_amount,
        });
    }

    /// Swap coins via Yuzu router
    public entry fun swap_via_yuzu<CoinIn, CoinOut>(
        user: &signer,
        amount_in: u64,
        amount_out_min: u64,
        fee_tier: u64,
    ) acquires RouterConfig {
        assert!(amount_in > 0, E_ZERO_AMOUNT);
        let user_addr = signer::address_of(user);
        
        // Get config
        let config = borrow_global_mut<RouterConfig>(@swap_router);
        
        // Calculate fee
        let fee_amount = (amount_in * config.fee_bps) / 10000;
        let swap_amount = amount_in - fee_amount;
        
        // Withdraw from user
        let coins_in = coin::withdraw<CoinIn>(user, amount_in);
        
        // Split fee
        let fee_coins = coin::extract(&mut coins_in, fee_amount);
        
        // Deposit fee to treasury
        if (!account::exists_at(config.fee_treasury)) {
            account::create_account(config.fee_treasury);
        };
        coin::deposit(config.fee_treasury, fee_coins);
        config.total_fees_collected = config.total_fees_collected + fee_amount;
        
        // Note: In production, this would call Yuzu's router
        // yuzuswap::router::swap_exact_coin_for_coin or similar
        // The frontend provides the pool and fee tier
        
        // Deposit remaining coins back (placeholder)
        coin::deposit(user_addr, coins_in);
        
        // Emit event
        event::emit_event(&mut config.swap_events, SwapEvent {
            user: user_addr,
            router_type: ROUTER_YUZU,
            src_coin: b"CoinIn",
            dst_coin: b"CoinOut",
            amount_in,
            amount_out: swap_amount,
            fee_collected: fee_amount,
        });
    }

    /// View function: Get current fee configuration
    #[view]
    public fun get_fee_config(): (u64, address, u64) acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        (config.fee_bps, config.fee_treasury, config.total_fees_collected)
    }

    /// View function: Calculate fee for amount
    #[view]
    public fun calculate_fee(amount_in: u64): u64 acquires RouterConfig {
        let config = borrow_global<RouterConfig>(@swap_router);
        (amount_in * config.fee_bps) / 10000
    }

    #[test_only]
    use aptos_framework::aptos_coin::{Self, AptosCoin};

    #[test(admin = @swap_router, fee_treasury = @0x999)]
    public fun test_initialize(admin: &signer, fee_treasury: &signer) {
        let fee_treasury_addr = signer::address_of(fee_treasury);
        
        // Initialize
        initialize(admin, 30, fee_treasury_addr); // 0.3% fee
        
        // Verify
        let (fee_bps, treasury, total) = get_fee_config();
        assert!(fee_bps == 30, 1);
        assert!(treasury == fee_treasury_addr, 2);
        assert!(total == 0, 3);
    }

    #[test(admin = @swap_router)]
    #[expected_failure(abort_code = E_INVALID_FEE)]
    public fun test_initialize_invalid_fee(admin: &signer) {
        initialize(admin, 2000, @0x999); // 20% - too high
    }
}
