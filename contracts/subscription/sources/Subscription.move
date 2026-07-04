module subscription_manager::subscription {
    use std::signer;
    use std::error;
    use aptos_framework::timestamp;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    /// Caller is not the admin (permission denied).
    const ERR_NOT_ADMIN: u64               = 1;
    /// Registry not yet initialised.
    const ERR_NOT_INITIALIZED: u64         = 2;
    /// Registry already initialised.
    const ERR_ALREADY_INITIALIZED: u64     = 3;
    /// months argument out of [1, 120] range.
    const ERR_INVALID_MONTHS: u64          = 4;
    /// Protocol is paused — no new purchases.
    const ERR_PAUSED: u64                  = 5;
    /// Caller is not the pending admin.
    const ERR_NOT_PENDING_ADMIN: u64       = 6;
    /// Proposed admin address is invalid (e.g. 0x0 or same as current).
    const ERR_INVALID_ADMIN: u64           = 7;
    /// discount_scope value is not 0, 1, or 2.
    const ERR_INVALID_DISCOUNT_SCOPE: u64  = 8;
    /// Treasury address must not be 0x0.
    const ERR_INVALID_TREASURY: u64        = 9;

    // -------------------------------------------------------------------------
    // Tier constants
    // -------------------------------------------------------------------------

    const TIER_FREE: u8 = 0;
    const TIER_PRO: u8  = 1;

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct SubscriptionRegistry has key {
        /// Current admin address (inherits deployer address at init).
        admin: address,
        /// Pending-admin address for 2-step transfer (0x0 when none).
        pending_admin: address,
        /// Address that receives subscription payments.
        treasury: address,
        /// Full price per billing period (base units).
        price_per_duration: u64,
        /// Discounted price per billing period (base units).
        discount_price_per_duration: u64,
        /// 0 = No discount, 1 = First period only, 2 = All periods.
        discount_scope: u8,
        /// Length of one billing period in seconds.
        duration_in_seconds: u64,
        /// Emergency pause flag — blocks upgrade_to_pro when true.
        paused: bool,
    }

    struct UserSubscription has key {
        tier: u8,
        expires_at: u64,
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    #[event]
    struct SubscriptionPurchasedEvent has drop, store {
        user: address,
        tier: u8,
        months: u64,
        expires_at: u64,
        amount_paid: u64,
    }

    #[event]
    struct PricingUpdatedEvent has drop, store {
        price_per_duration: u64,
        discount_price_per_duration: u64,
        discount_scope: u8,
        duration_in_seconds: u64,
        timestamp: u64,
    }

    #[event]
    struct TreasuryUpdatedEvent has drop, store {
        old_treasury: address,
        new_treasury: address,
        timestamp: u64,
    }

    #[event]
    struct PauseUpdatedEvent has drop, store {
        paused: bool,
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

    // =========================================================================
    // Initialization
    // =========================================================================

    /// Initialize the subscription registry. Can only be called once by the
    /// module deployer.
    public entry fun initialize(
        admin: &signer,
        treasury: address,
        price_per_duration: u64,
        discount_price_per_duration: u64,
        discount_scope: u8,
        duration_in_seconds: u64
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(
            admin_addr == @subscription_manager,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        assert!(
            !exists<SubscriptionRegistry>(admin_addr),
            error::already_exists(ERR_ALREADY_INITIALIZED)
        );
        assert!(
            discount_scope <= 2,
            error::invalid_argument(ERR_INVALID_DISCOUNT_SCOPE)
        );
        assert!(
            treasury != @0x0,
            error::invalid_argument(ERR_INVALID_TREASURY)
        );

        move_to(admin, SubscriptionRegistry {
            admin: admin_addr,
            pending_admin: @0x0,
            treasury,
            price_per_duration,
            discount_price_per_duration,
            discount_scope,
            duration_in_seconds,
            paused: false,
        });
    }

    // =========================================================================
    // Admin management (2-step transfer)
    // =========================================================================

    /// Step 1: Current admin nominates a new admin.
    public entry fun transfer_admin(
        admin: &signer,
        new_admin: address
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            admin_addr == registry.admin,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        assert!(
            new_admin != @0x0 && new_admin != registry.admin,
            error::invalid_argument(ERR_INVALID_ADMIN)
        );

        registry.pending_admin = new_admin;

        aptos_framework::event::emit(AdminTransferInitiated {
            current_admin: admin_addr,
            pending_admin: new_admin,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Step 2: Pending admin accepts the role.
    public entry fun accept_admin(
        new_admin: &signer
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        let new_admin_addr = signer::address_of(new_admin);
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            new_admin_addr == registry.pending_admin,
            error::permission_denied(ERR_NOT_PENDING_ADMIN)
        );

        let old_admin = registry.admin;
        registry.admin         = new_admin_addr;
        registry.pending_admin = @0x0;

        aptos_framework::event::emit(AdminTransferCompleted {
            old_admin,
            new_admin: new_admin_addr,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Cancel a pending admin transfer (current admin only).
    public entry fun cancel_admin_transfer(
        admin: &signer
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            admin_addr == registry.admin,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        registry.pending_admin = @0x0;
    }

    // =========================================================================
    // Admin config management
    // =========================================================================

    /// Update pricing configuration. Emits PricingUpdatedEvent.
    public entry fun update_pricing(
        admin: &signer,
        price_per_duration: u64,
        discount_price_per_duration: u64,
        discount_scope: u8,
        duration_in_seconds: u64
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        assert!(
            discount_scope <= 2,
            error::invalid_argument(ERR_INVALID_DISCOUNT_SCOPE)
        );
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            signer::address_of(admin) == registry.admin,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        registry.price_per_duration          = price_per_duration;
        registry.discount_price_per_duration = discount_price_per_duration;
        registry.discount_scope              = discount_scope;
        registry.duration_in_seconds         = duration_in_seconds;

        aptos_framework::event::emit(PricingUpdatedEvent {
            price_per_duration,
            discount_price_per_duration,
            discount_scope,
            duration_in_seconds,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Update the treasury address. Emits TreasuryUpdatedEvent.
    public entry fun set_treasury(
        admin: &signer,
        new_treasury: address
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        assert!(
            new_treasury != @0x0,
            error::invalid_argument(ERR_INVALID_TREASURY)
        );
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            signer::address_of(admin) == registry.admin,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        let old_treasury = registry.treasury;
        registry.treasury = new_treasury;

        aptos_framework::event::emit(TreasuryUpdatedEvent {
            old_treasury,
            new_treasury,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Emergency pause / unpause. Emits PauseUpdatedEvent.
    public entry fun set_paused(
        admin: &signer,
        is_paused: bool
    ) acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        assert!(
            signer::address_of(admin) == registry.admin,
            error::permission_denied(ERR_NOT_ADMIN)
        );
        registry.paused = is_paused;

        aptos_framework::event::emit(PauseUpdatedEvent {
            paused: is_paused,
            timestamp: timestamp::now_seconds(),
        });
    }

    // =========================================================================
    // User actions
    // =========================================================================

    /// User upgrades to pro tier by paying for a specified number of periods.
    /// months = number of billing periods (1 – 120).
    public entry fun upgrade_to_pro(
        user: &signer,
        months: u64
    ) acquires SubscriptionRegistry, UserSubscription {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        let user_addr = signer::address_of(user);
        assert!(
            months > 0 && months <= 120,
            error::invalid_argument(ERR_INVALID_MONTHS)
        );

        // Read all we need then drop the borrow before touching UserSubscription.
        let (amount_to_pay, treasury, current_time, additional_time) = {
            let registry = borrow_global<SubscriptionRegistry>(@subscription_manager);
            assert!(
                !registry.paused,
                error::unavailable(ERR_PAUSED)
            );
            let pay = if (registry.discount_scope == 1) {
                registry.discount_price_per_duration + (months - 1) * registry.price_per_duration
            } else if (registry.discount_scope == 2) {
                registry.discount_price_per_duration * months
            } else {
                registry.price_per_duration * months
            };
            (
                pay,
                registry.treasury,
                timestamp::now_seconds(),
                months * registry.duration_in_seconds,
            )
        };

        if (amount_to_pay > 0) {
            coin::transfer<AptosCoin>(user, treasury, amount_to_pay);
        };

        let new_expiry = if (exists<UserSubscription>(user_addr)) {
            let sub = borrow_global_mut<UserSubscription>(user_addr);
            if (sub.tier == TIER_PRO && sub.expires_at > current_time) {
                // Active pro — extend from the current expiry.
                sub.expires_at = sub.expires_at + additional_time;
                sub.expires_at
            } else {
                // Expired or free — reset.
                sub.tier       = TIER_PRO;
                sub.expires_at = current_time + additional_time;
                sub.expires_at
            }
        } else {
            let expires_at = current_time + additional_time;
            move_to(user, UserSubscription { tier: TIER_PRO, expires_at });
            expires_at
        };

        aptos_framework::event::emit(SubscriptionPurchasedEvent {
            user: user_addr,
            tier: TIER_PRO,
            months,
            expires_at: new_expiry,
            amount_paid: amount_to_pay,
        });
    }

    // =========================================================================
    // View functions
    // =========================================================================

    #[view]
    public fun get_subscription(user_addr: address): (u8, u64) acquires UserSubscription {
        if (!exists<UserSubscription>(user_addr)) {
            return (TIER_FREE, 0)
        };
        let sub = borrow_global<UserSubscription>(user_addr);
        let current_time = timestamp::now_seconds();
        if (sub.expires_at > current_time) {
            (sub.tier, sub.expires_at)
        } else {
            (TIER_FREE, sub.expires_at)
        }
    }

    #[view]
    public fun is_paused(): bool acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        borrow_global<SubscriptionRegistry>(@subscription_manager).paused
    }

    #[view]
    public fun get_admin(): address acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        borrow_global<SubscriptionRegistry>(@subscription_manager).admin
    }

    #[view]
    public fun get_pending_admin(): address acquires SubscriptionRegistry {
        assert!(
            exists<SubscriptionRegistry>(@subscription_manager),
            error::not_found(ERR_NOT_INITIALIZED)
        );
        borrow_global<SubscriptionRegistry>(@subscription_manager).pending_admin
    }

    // =========================================================================
    // Tests
    // =========================================================================

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::coin::MintCapability;
    #[test_only]
    use aptos_framework::aptos_coin;

    #[test_only]
    fun setup_test(
        admin: &signer,
        framework: &signer
    ): MintCapability<aptos_coin::AptosCoin> {
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
        // price = 1 APT (1e8 base units), no discount, 30-day period
        initialize(admin, @0x999, 100_000_000, 50_000_000, 0, 2_592_000);
    }

    // Register an account + coin store for an address so coin::transfer succeeds.
    #[test_only]
    fun setup_account(addr: address) {
        account::create_account_for_test(addr);
        // The account needs to register for AptosCoin to receive transfers.
        // We can't get a signer here so we skip coin::register and instead
        // use coin::register via the signer when we have one (in the test body).
    }

    // -- Initialization --

    #[test(admin = @subscription_manager, framework = @0x1)]
    fun test_initialize(admin: &signer, framework: &signer) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        assert!(!is_paused(), 1);
        assert!(get_admin() == @subscription_manager, 2);
        assert!(get_pending_admin() == @0x0, 3);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, framework = @0x1)]
    #[expected_failure(abort_code = 0x80003, location = subscription_manager::subscription)]
    fun test_double_initialize(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        default_init(admin);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @0xDEAD, framework = @0x1)]
    #[expected_failure(abort_code = 0x50001, location = subscription_manager::subscription)]
    fun test_initialize_wrong_admin(admin: &signer, framework: &signer) {
        let _mc = setup_test(admin, framework);
        initialize(admin, @0x999, 100_000_000, 50_000_000, 0, 2_592_000);
        coin::destroy_mint_cap(_mc);
    }

    // -- Pause --

    #[test(admin = @subscription_manager, framework = @0x1)]
    fun test_pause_unpause(admin: &signer, framework: &signer) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        assert!(!is_paused(), 1);
        set_paused(admin, true);
        assert!(is_paused(), 2);
        set_paused(admin, false);
        assert!(!is_paused(), 3);
        coin::destroy_mint_cap(_mc);
    }

    // error::unavailable(ERR_PAUSED) = 0xD0005 = 851973
    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    #[expected_failure(abort_code = 851973, location = subscription_manager::subscription)]
    fun test_upgrade_fails_when_paused(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        set_paused(admin, true);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        let coins = coin::mint<aptos_coin::AptosCoin>(200_000_000, &_mc);
        coin::deposit(signer::address_of(user), coins);
        upgrade_to_pro(user, 1);
        coin::destroy_mint_cap(_mc);
    }

    // -- Subscription purchase & renewal --

    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    fun test_upgrade_to_pro(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        // Setup user + treasury accounts with coin stores so transfers work.
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        account::create_account_for_test(@0x999);
        // Treasury registers its own coin store in a separate tx; in tests we
        // use a dedicated treasury signer. Create it here to allow deposits.
        let treasury_signer = account::create_signer_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(&treasury_signer);
        let coins = coin::mint<aptos_coin::AptosCoin>(200_000_000, &_mc);
        coin::deposit(signer::address_of(user), coins);

        upgrade_to_pro(user, 1);
        let (tier, _expires) = get_subscription(signer::address_of(user));
        assert!(tier == 1u8, 1); // TIER_PRO

        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    fun test_renew_extends_expiry(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        account::create_account_for_test(@0x999);
        let treasury_signer = account::create_signer_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(&treasury_signer);
        let coins = coin::mint<aptos_coin::AptosCoin>(300_000_000, &_mc);
        coin::deposit(signer::address_of(user), coins);

        upgrade_to_pro(user, 1);
        let (_, expiry1) = get_subscription(signer::address_of(user));
        upgrade_to_pro(user, 1);
        let (_, expiry2) = get_subscription(signer::address_of(user));
        // Second purchase should extend by one more period.
        assert!(expiry2 == expiry1 + 2_592_000, 1);

        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    fun test_subscription_expired_returns_free(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        account::create_account_for_test(@0x999);
        let treasury_signer = account::create_signer_for_test(@0x999);
        coin::register<aptos_coin::AptosCoin>(&treasury_signer);
        let coins = coin::mint<aptos_coin::AptosCoin>(200_000_000, &_mc);
        coin::deposit(signer::address_of(user), coins);

        upgrade_to_pro(user, 1);
        // Fast-forward past the 30-day period.
        timestamp::fast_forward_seconds(2_592_001);
        let (tier, _) = get_subscription(signer::address_of(user));
        assert!(tier == 0u8, 1); // TIER_FREE after expiry

        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    #[expected_failure(abort_code = 0x10004, location = subscription_manager::subscription)]
    fun test_invalid_months_zero(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(user));
        upgrade_to_pro(user, 0);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, user = @0xBEEF, framework = @0x1)]
    #[expected_failure(abort_code = 0x10004, location = subscription_manager::subscription)]
    fun test_invalid_months_over_max(
        admin: &signer,
        user: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry, UserSubscription {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(user));
        upgrade_to_pro(user, 121);
        coin::destroy_mint_cap(_mc);
    }

    // -- Pricing update --

    #[test(admin = @subscription_manager, framework = @0x1)]
    fun test_update_pricing(admin: &signer, framework: &signer) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        update_pricing(admin, 200_000_000, 100_000_000, 1, 2_592_000);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, attacker = @0xDEAD, framework = @0x1)]
    #[expected_failure(abort_code = 0x50001, location = subscription_manager::subscription)]
    fun test_unauthorized_cannot_update_pricing(
        admin: &signer,
        attacker: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(attacker));
        update_pricing(attacker, 999, 0, 0, 1);
        coin::destroy_mint_cap(_mc);
    }

    // -- Treasury update --

    #[test(admin = @subscription_manager, framework = @0x1)]
    fun test_set_treasury(admin: &signer, framework: &signer) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        set_treasury(admin, @0xCAFE);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, attacker = @0xDEAD, framework = @0x1)]
    #[expected_failure(abort_code = 0x50001, location = subscription_manager::subscription)]
    fun test_unauthorized_cannot_set_treasury(
        admin: &signer,
        attacker: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(attacker));
        set_treasury(attacker, @0xCAFE);
        coin::destroy_mint_cap(_mc);
    }

    // -- Admin 2-step transfer --

    #[test(admin = @subscription_manager, new_admin = @0xBEEF, framework = @0x1)]
    fun test_admin_transfer_2step(
        admin: &signer,
        new_admin: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(new_admin));
        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);
        accept_admin(new_admin);
        assert!(get_admin() == @0xBEEF, 2);
        assert!(get_pending_admin() == @0x0, 3);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, framework = @0x1)]
    fun test_cancel_admin_transfer(admin: &signer, framework: &signer) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        transfer_admin(admin, @0xBEEF);
        assert!(get_pending_admin() == @0xBEEF, 1);
        cancel_admin_transfer(admin);
        assert!(get_pending_admin() == @0x0, 2);
        coin::destroy_mint_cap(_mc);
    }

    #[test(admin = @subscription_manager, impostor = @0xDEAD, framework = @0x1)]
    #[expected_failure(abort_code = 0x50006, location = subscription_manager::subscription)]
    fun test_non_pending_admin_cannot_accept(
        admin: &signer,
        impostor: &signer,
        framework: &signer
    ) acquires SubscriptionRegistry {
        let _mc = setup_test(admin, framework);
        default_init(admin);
        account::create_account_for_test(signer::address_of(impostor));
        transfer_admin(admin, @0xBEEF);
        accept_admin(impostor); // should abort
        coin::destroy_mint_cap(_mc);
    }
}
