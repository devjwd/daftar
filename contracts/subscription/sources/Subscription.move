module subscription_manager::subscription {
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::account;
    use aptos_framework::event::{Self, EventHandle};

    /// Error codes
    const ERR_NOT_ADMIN: u64 = 1;
    const ERR_NOT_INITIALIZED: u64 = 2;
    const ERR_ALREADY_INITIALIZED: u64 = 3;
    const ERR_INVALID_MONTHS: u64 = 4;

    /// Subscription Tier definitions
    const TIER_FREE: u8 = 0;
    const TIER_PRO: u8 = 1;

    struct SubscriptionRegistry has key {
        treasury: address,
        price_per_duration: u64, // Price in base units
        discount_price_per_duration: u64,
        discount_scope: u8, // 0: None, 1: First Period, 2: All Periods
        duration_in_seconds: u64,
    }

    #[event]
    struct SubscriptionPurchasedEvent has drop, store {
        user: address,
        tier: u8,
        months: u64,
        expires_at: u64,
        amount_paid: u64,
    }

    struct UserSubscription has key {
        tier: u8,
        expires_at: u64,
    }

    /// Initialize the subscription registry. Can only be called by the module deployer.
    public entry fun initialize(
        admin: &signer, 
        treasury: address, 
        price_per_duration: u64,
        discount_price_per_duration: u64,
        discount_scope: u8,
        duration_in_seconds: u64
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @subscription_manager, ERR_NOT_ADMIN);
        assert!(!exists<SubscriptionRegistry>(admin_addr), ERR_ALREADY_INITIALIZED);

        move_to(admin, SubscriptionRegistry {
            treasury,
            price_per_duration,
            discount_price_per_duration,
            discount_scope,
            duration_in_seconds,
        });
    }

    /// Admin can update the pricing config.
    public entry fun update_pricing(
        admin: &signer,
        price_per_duration: u64,
        discount_price_per_duration: u64,
        discount_scope: u8,
        duration_in_seconds: u64
    ) acquires SubscriptionRegistry {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @subscription_manager, ERR_NOT_ADMIN);
        assert!(exists<SubscriptionRegistry>(admin_addr), ERR_NOT_INITIALIZED);

        let registry = borrow_global_mut<SubscriptionRegistry>(admin_addr);
        registry.price_per_duration = price_per_duration;
        registry.discount_price_per_duration = discount_price_per_duration;
        registry.discount_scope = discount_scope;
        registry.duration_in_seconds = duration_in_seconds;
    }

    /// Admin can update the treasury address.
    public entry fun set_treasury(admin: &signer, new_treasury: address) acquires SubscriptionRegistry {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @subscription_manager, ERR_NOT_ADMIN);
        assert!(exists<SubscriptionRegistry>(admin_addr), ERR_NOT_INITIALIZED);

        let registry = borrow_global_mut<SubscriptionRegistry>(admin_addr);
        registry.treasury = new_treasury;
    }

    /// User upgrades to pro tier by paying for a specified number of months.
    public entry fun upgrade_to_pro(user: &signer, months: u64) acquires SubscriptionRegistry, UserSubscription {
        let user_addr = signer::address_of(user);
        assert!(months > 0 && months <= 120, ERR_INVALID_MONTHS);
        assert!(exists<SubscriptionRegistry>(@subscription_manager), ERR_NOT_INITIALIZED);

        let registry = borrow_global_mut<SubscriptionRegistry>(@subscription_manager);
        
        let amount_to_pay = if (registry.discount_scope == 1) {
            registry.discount_price_per_duration + (months - 1) * registry.price_per_duration
        } else if (registry.discount_scope == 2) {
            registry.discount_price_per_duration * months
        } else {
            registry.price_per_duration * months
        };

        // Transfer funds from user to treasury
        if (amount_to_pay > 0) {
            coin::transfer<AptosCoin>(user, registry.treasury, amount_to_pay);
        };

        let current_time = timestamp::now_seconds();
        let additional_time = months * registry.duration_in_seconds;
        
        let new_expiry = if (exists<UserSubscription>(user_addr)) {
            let sub = borrow_global_mut<UserSubscription>(user_addr);
            // If already pro and not expired, extend from current expiry
            if (sub.tier == TIER_PRO && sub.expires_at > current_time) {
                sub.expires_at = sub.expires_at + additional_time;
                sub.expires_at
            } else {
                // Otherwise start fresh
                sub.tier = TIER_PRO;
                sub.expires_at = current_time + additional_time;
                sub.expires_at
            }
        } else {
            let expires_at = current_time + additional_time;
            move_to(user, UserSubscription {
                tier: TIER_PRO,
                expires_at,
            });
            expires_at
        };

        event::emit(SubscriptionPurchasedEvent {
            user: user_addr,
            tier: TIER_PRO,
            months,
            expires_at: new_expiry,
            amount_paid: amount_to_pay,
        });
    }

    /// View function to get user subscription tier and expiry
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
            // Expired fallback to free
            (TIER_FREE, sub.expires_at)
        }
    }
}
