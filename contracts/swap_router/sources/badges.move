module swap_router::badges {
    use std::bcs;
    use std::signer;
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use aptos_framework::type_info;
    use aptos_framework::aptos_coin;
    use aptos_std::table::{Self, Table};
    use aptos_framework::event;

    // --- ERROR CODES ---
    const E_NOT_ADMIN: u64 = 1;
    const E_BADGE_NOT_FOUND: u64 = 2;
    const E_ALREADY_MINTED: u64 = 3;
    const E_NOT_ELIGIBLE: u64 = 4;
    const E_BAD_RULE: u64 = 5;
    const E_COIN_TYPE_MISMATCH: u64 = 6;
    const E_BAD_ADMIN_ADDRESS: u64 = 7;
    const E_NOT_PENDING_ADMIN: u64 = 8;
    const E_BADGE_PAUSED: u64 = 9;
    const E_BADGE_DISCONTINUED: u64 = 10;
    const E_BADGE_NOT_STARTED: u64 = 11;
    const E_BADGE_EXPIRED: u64 = 12;
    const E_BADGE_ALREADY_ACTIVE: u64 = 13;
    const E_BADGE_ALREADY_DISCONTINUED: u64 = 14;
    const E_INVALID_TIME_RANGE: u64 = 15;
    const E_REGISTRY_ALREADY_EXISTS: u64 = 16;
    const E_SUPPLY_REACHED: u64 = 17;
    const E_INSUFFICIENT_FEE: u64 = 18;
    const E_FEE_TREASURY_NOT_SET: u64 = 19;

    // --- CONSTANTS ---
    const RULE_ALLOWLIST: u8 = 1;
    const RULE_MIN_BALANCE: u8 = 2;
    const RULE_ATTESTATION: u8 = 3;
    const RULE_TX_COUNT: u8 = 4;
    const RULE_ACTIVE_DAYS: u8 = 5;
    const RULE_PROTOCOL_COUNT: u8 = 6;
    const RULE_DAPP_USAGE: u8 = 7;
    const RULE_HOLDING_PERIOD: u8 = 8;
    const RULE_NFT_HOLDER: u8 = 9;
    const RULE_COMPOSITE: u8 = 10;

    const STATUS_ACTIVE: u8 = 1;
    const STATUS_PAUSED: u8 = 2;
    const STATUS_DISCONTINUED: u8 = 3;

    // --- STRUCTS ---
    struct BadgeMetadata has store, drop, copy {
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
    }

    struct RuleParams has store, drop, copy {
        min_value: u64,
        coin_type: type_info::TypeInfo,
        coin_type_str: vector<u8>,
        dapp_address: vector<u8>,
        extra_data: vector<u8>,
    }

    struct BadgeDefinition has store, drop {
        id: u64,
        metadata: BadgeMetadata,
        rule_type: u8,
        rule_params: RuleParams,
        rule_note: vector<u8>,
        status: u8,
        starts_at: u64,
        ends_at: u64,
        created_at: u64,
        updated_at: u64,
        paused_at: u64,
        discontinued_at: u64,
            mint_fee: u64,             // Fee in octas (0 = free). 1 MOVE = 100_000_000 octas
            total_minted: u64,
        max_supply: u64,
    }

    struct BadgeAllowlist has store {
        entries: Table<address, bool>,
    }

    struct BadgeRegistry has key {
        admin: address,
        pending_admin: address,
        fee_treasury: address,
        next_id: u64,
        badge_ids: vector<u64>,
        badges: Table<u64, BadgeDefinition>,
        allowlists: Table<u64, BadgeAllowlist>,
    }

    struct BadgeInstance has store, drop, copy {
        badge_id: u64,
        minted_at: u64,
        badge_snapshot: BadgeMetadata,
    }

    struct BadgeStore has key {
        owner: address,
        badges: Table<u64, BadgeInstance>,
        badge_ids: vector<u64>,
    }

    // --- EVENTS ---
    #[event] struct BadgeCreated has drop, store { badge_id: u64, name: vector<u8>, rule_type: u8, mint_fee: u64, admin: address, timestamp: u64 }
    #[event] struct BadgePaused has drop, store { badge_id: u64, admin: address, timestamp: u64 }
    #[event] struct BadgeResumed has drop, store { badge_id: u64, admin: address, timestamp: u64 }
    #[event] struct BadgeDiscontinued has drop, store { badge_id: u64, admin: address, timestamp: u64 }
    #[event] struct BadgeMinted has drop, store { badge_id: u64, recipient: address, timestamp: u64 }
    #[event] struct BadgeFeePaid has drop, store { badge_id: u64, payer: address, amount: u64, treasury: address, timestamp: u64 }
    #[event] struct BadgeFeeUpdated has drop, store { badge_id: u64, old_fee: u64, new_fee: u64, admin: address, timestamp: u64 }
    #[event] struct FeeTreasuryUpdated has drop, store { old_treasury: address, new_treasury: address, admin: address, timestamp: u64 }
    #[event] struct AllowlistUpdated has drop, store { badge_id: u64, addresses_added: u64, addresses_removed: u64, admin: address, timestamp: u64 }

    // --- INITIALIZATION ---
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @swap_router, E_BAD_ADMIN_ADDRESS);
        assert!(!exists<BadgeRegistry>(@swap_router), E_REGISTRY_ALREADY_EXISTS);
        
        move_to(admin, BadgeRegistry {
            admin: admin_addr,
            pending_admin: @0x0,
            fee_treasury: admin_addr,  // Fees go to admin by default
            next_id: 1,
            badge_ids: vector::empty<u64>(),
            badges: table::new(),
            allowlists: table::new(),
        });
    }

    // --- CORE LOGIC ---
    public entry fun create_badge(
        admin: &signer,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
        rule_type: u8,
        rule_note: vector<u8>,
        min_value: u64,
        coin_type_str: vector<u8>,
        dapp_address: vector<u8>,
        extra_data: vector<u8>,
        starts_at: u64,
        ends_at: u64,
        max_supply: u64,
        mint_fee: u64,             // Fee in octas (0 = free, 100_000_000 = 1 MOVE)
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        
        if (starts_at > 0 && ends_at > 0) assert!(ends_at > starts_at, E_INVALID_TIME_RANGE);
        assert!(rule_type >= RULE_ALLOWLIST && rule_type <= RULE_COMPOSITE, E_BAD_RULE);

        let badge_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        vector::push_back(&mut registry.badge_ids, badge_id);

        let now = timestamp::now_seconds();
        
        let metadata = BadgeMetadata { name: copy name, description, image_uri, metadata_uri, metadata_hash, category, rarity, xp_value };
        let rule_params = RuleParams { 
            min_value, 
            coin_type: type_info::type_of<aptos_coin::AptosCoin>(), 
            coin_type_str, 
            dapp_address, 
            extra_data 
        };

        let definition = BadgeDefinition {
            id: badge_id, metadata, rule_type, rule_params, rule_note,
            status: STATUS_ACTIVE, starts_at, ends_at,
            created_at: now, updated_at: now, paused_at: 0, discontinued_at: 0,
            mint_fee,
            total_minted: 0, max_supply
        };

        table::add(&mut registry.badges, badge_id, definition);
        table::add(&mut registry.allowlists, badge_id, BadgeAllowlist { entries: table::new() });

        event::emit(BadgeCreated { badge_id, name, rule_type, mint_fee, admin: admin_addr, timestamp: now });
    }

    public entry fun mint(user: &signer, badge_id: u64) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        
        // 1. Validate existence and global eligibility
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge_ref = table::borrow(&registry.badges, badge_id);
        validate_mint_eligibility(badge_ref);

        // 2. Validate Rule Specifics (Allowlist/Attestation)
        let allowlist = table::borrow(&registry.allowlists, badge_id);
        assert!(table::contains(&allowlist.entries, user_addr), E_NOT_ELIGIBLE);

        // 3. Process Mint
        execute_mint(user, registry, badge_id);
    }

    public entry fun mint_with_balance<CoinType>(user: &signer, badge_id: u64) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge_ref = table::borrow(&registry.badges, badge_id);
        
        validate_mint_eligibility(badge_ref);
        assert!(badge_ref.rule_type == RULE_MIN_BALANCE, E_BAD_RULE);
        assert!(bcs::to_bytes(&badge_ref.rule_params.coin_type) == bcs::to_bytes(&type_info::type_of<CoinType>()), E_COIN_TYPE_MISMATCH);

        let balance = coin::balance<CoinType>(user_addr);
        assert!(balance >= badge_ref.rule_params.min_value, E_NOT_ELIGIBLE);

        execute_mint(user, registry, badge_id);
    }

    // --- HELPER LOGIC ---

    fun validate_mint_eligibility(badge: &BadgeDefinition) {
        let now = timestamp::now_seconds();
        assert!(badge.status == STATUS_ACTIVE, E_BADGE_PAUSED);
        if (badge.starts_at > 0) assert!(now >= badge.starts_at, E_BADGE_NOT_STARTED);
        if (badge.ends_at > 0) assert!(now <= badge.ends_at, E_BADGE_EXPIRED);
        if (badge.max_supply > 0) assert!(badge.total_minted < badge.max_supply, E_SUPPLY_REACHED);
    }

    fun execute_mint(user: &signer, registry: &mut BadgeRegistry, badge_id: u64) acquires BadgeStore {
        let user_addr = signer::address_of(user);
        ensure_badge_store(user);

        let store = borrow_global_mut<BadgeStore>(user_addr);
        assert!(!table::contains(&store.badges, badge_id), E_ALREADY_MINTED);

        // ── Fee collection ──────────────────────────────────────────────────
        // Read fee info via immutable borrow before the mutable borrow below.
        let mint_fee = table::borrow(&registry.badges, badge_id).mint_fee;
        let fee_treasury = registry.fee_treasury;

        if (mint_fee > 0) {
            assert!(fee_treasury != @0x0, E_FEE_TREASURY_NOT_SET);
            // Ensure the user has enough MOVE to cover the fee.
            assert!(coin::balance<aptos_coin::AptosCoin>(user_addr) >= mint_fee, E_INSUFFICIENT_FEE);
            coin::transfer<aptos_coin::AptosCoin>(user, fee_treasury, mint_fee);
            let fee_ts = timestamp::now_seconds();
            event::emit(BadgeFeePaid { badge_id, payer: user_addr, amount: mint_fee, treasury: fee_treasury, timestamp: fee_ts });
        };

        // ── Record the badge instance ───────────────────────────────────────
        let badge_mut = table::borrow_mut(&mut registry.badges, badge_id);
        let now = timestamp::now_seconds();

        let instance = BadgeInstance {
            badge_id,
            minted_at: now,
            badge_snapshot: *&badge_mut.metadata,
        };

        table::add(&mut store.badges, badge_id, instance);
        vector::push_back(&mut store.badge_ids, badge_id);
        badge_mut.total_minted = badge_mut.total_minted + 1;

        event::emit(BadgeMinted { badge_id, recipient: user_addr, timestamp: now });
    }

    fun ensure_badge_store(user: &signer) {
        let user_addr = signer::address_of(user);
        if (!exists<BadgeStore>(user_addr)) {
            move_to(user, BadgeStore {
                owner: user_addr,
                badges: table::new(),
                badge_ids: vector::empty(),
            });
        };
    }

    // --- ADMIN: FEE MANAGEMENT ---

    /// Update the mint fee for an existing badge (0 = make it free).
    public entry fun update_badge_fee(
        admin: &signer,
        badge_id: u64,
        new_fee: u64,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        let old_fee = badge.mint_fee;
        badge.mint_fee = new_fee;
        badge.updated_at = timestamp::now_seconds();

        event::emit(BadgeFeeUpdated { badge_id, old_fee, new_fee, admin: admin_addr, timestamp: badge.updated_at });
    }

    /// Change the wallet that receives all future mint fees.
    public entry fun set_fee_treasury(
        admin: &signer,
        new_treasury: address,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(new_treasury != @0x0, E_BAD_ADMIN_ADDRESS);

        let old_treasury = registry.fee_treasury;
        registry.fee_treasury = new_treasury;

        event::emit(FeeTreasuryUpdated { old_treasury, new_treasury, admin: admin_addr, timestamp: timestamp::now_seconds() });
    }

    // --- ADMIN: BADGE LIFECYCLE ---

    public entry fun pause_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status == STATUS_ACTIVE, E_BADGE_PAUSED);

        let now = timestamp::now_seconds();
        badge.status = STATUS_PAUSED;
        badge.paused_at = now;
        badge.updated_at = now;

        event::emit(BadgePaused { badge_id, admin: admin_addr, timestamp: now });
    }

    public entry fun resume_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status != STATUS_DISCONTINUED, E_BADGE_DISCONTINUED);

        let now = timestamp::now_seconds();
        badge.status = STATUS_ACTIVE;
        badge.updated_at = now;

        event::emit(BadgeResumed { badge_id, admin: admin_addr, timestamp: now });
    }

    public entry fun discontinue_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status != STATUS_DISCONTINUED, E_BADGE_ALREADY_DISCONTINUED);

        let now = timestamp::now_seconds();
        badge.status = STATUS_DISCONTINUED;
        badge.discontinued_at = now;
        badge.updated_at = now;

        event::emit(BadgeDiscontinued { badge_id, admin: admin_addr, timestamp: now });
    }

    // --- ADMIN: ALLOWLIST MANAGEMENT ---

    public entry fun add_allowlist_entries(
        admin: &signer,
        badge_id: u64,
        addresses: vector<address>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        assert!(table::contains(&registry.allowlists, badge_id), E_BADGE_NOT_FOUND);

        let now = timestamp::now_seconds();
        let allowlist = table::borrow_mut(&mut registry.allowlists, badge_id);
        let len = vector::length(&addresses);
        let i = 0;
        let added = 0;

        while (i < len) {
            let addr = *vector::borrow(&addresses, i);
            if (!table::contains(&allowlist.entries, addr)) {
                table::add(&mut allowlist.entries, addr, true);
                added = added + 1;
            };
            i = i + 1;
        };

        event::emit(AllowlistUpdated {
            badge_id,
            addresses_added: added,
            addresses_removed: 0,
            admin: admin_addr,
            timestamp: now,
        });
    }

    public entry fun remove_allowlist_entries(
        admin: &signer,
        badge_id: u64,
        addresses: vector<address>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        assert!(table::contains(&registry.allowlists, badge_id), E_BADGE_NOT_FOUND);

        let now = timestamp::now_seconds();
        let allowlist = table::borrow_mut(&mut registry.allowlists, badge_id);
        let len = vector::length(&addresses);
        let i = 0;
        let removed = 0;

        while (i < len) {
            let addr = *vector::borrow(&addresses, i);
            if (table::contains(&allowlist.entries, addr)) {
                table::remove(&mut allowlist.entries, addr);
                removed = removed + 1;
            };
            i = i + 1;
        };

        event::emit(AllowlistUpdated {
            badge_id,
            addresses_added: 0,
            addresses_removed: removed,
            admin: admin_addr,
            timestamp: now,
        });
    }

    // --- VIEW FUNCTIONS ---

    #[view]
    public fun get_badge_ids(): vector<u64> acquires BadgeRegistry {
        *&borrow_global<BadgeRegistry>(@swap_router).badge_ids
    }

    #[view]
    public fun get_active_badge_ids(): vector<u64> acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        let ids = vector::empty<u64>();
        let len = vector::length(&registry.badge_ids);
        let i = 0;

        while (i < len) {
            let badge_id = *vector::borrow(&registry.badge_ids, i);
            let badge = table::borrow(&registry.badges, badge_id);
            if (badge.status == STATUS_ACTIVE) {
                vector::push_back(&mut ids, badge_id);
            };
            i = i + 1;
        };

        ids
    }

    #[view]
    public fun get_badge(badge_id: u64): (
        u64, vector<u8>, vector<u8>, vector<u8>, vector<u8>, vector<u8>, vector<u8>,
        u8, u64, u8, vector<u8>, u64, vector<u8>, vector<u8>, u8, u64, u64, u64, u64, u64, u64
    ) acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow(&registry.badges, badge_id);

        (
            badge.id,
            *&badge.metadata.name,
            *&badge.metadata.description,
            *&badge.metadata.image_uri,
            *&badge.metadata.metadata_uri,
            *&badge.metadata.metadata_hash,
            *&badge.metadata.category,
            badge.metadata.rarity,
            badge.metadata.xp_value,
            badge.rule_type,
            *&badge.rule_note,
            badge.rule_params.min_value,
            *&badge.rule_params.coin_type_str,
            *&badge.rule_params.dapp_address,
            badge.status,
            badge.starts_at,
            badge.ends_at,
            badge.created_at,
            badge.updated_at,
            badge.total_minted,
            badge.max_supply,
        )
    }

    #[view]
    public fun has_badge(owner: address, badge_id: u64): bool acquires BadgeStore {
        if (!exists<BadgeStore>(owner)) return false;
        let store = borrow_global<BadgeStore>(owner);
        table::contains(&store.badges, badge_id)
    }

    #[view]
    public fun is_allowlisted(owner: address, badge_id: u64): bool acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        if (!table::contains(&registry.allowlists, badge_id)) return false;
        let allowlist = table::borrow(&registry.allowlists, badge_id);
        table::contains(&allowlist.entries, owner)
    }

    #[view]
    public fun is_badge_available(badge_id: u64): bool acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        if (!table::contains(&registry.badges, badge_id)) return false;
        let badge = table::borrow(&registry.badges, badge_id);

        let now = timestamp::now_seconds();
        (badge.status == STATUS_ACTIVE) &&
        (badge.starts_at == 0 || now >= badge.starts_at) &&
        (badge.ends_at == 0 || now <= badge.ends_at) &&
        (badge.max_supply == 0 || badge.total_minted < badge.max_supply)
    }

    /// Returns the mint fee (in octas) for a given badge. 0 = free.
    #[view]
    public fun get_badge_fee(badge_id: u64): u64 acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        table::borrow(&registry.badges, badge_id).mint_fee
    }

    /// Returns the address that receives all mint fees.
    #[view]
    public fun get_fee_treasury(): address acquires BadgeRegistry {
        borrow_global<BadgeRegistry>(@swap_router).fee_treasury
    }

    #[view]
    public fun get_badge_stats(badge_id: u64): (u64, u64, u8) acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow(&registry.badges, badge_id);
        (badge.total_minted, badge.max_supply, badge.status)
    }

    #[view]
    public fun get_user_badge_ids(owner: address): vector<u64> acquires BadgeStore {
        if (!exists<BadgeStore>(owner)) {
            vector::empty<u64>()
        } else {
            *&borrow_global<BadgeStore>(owner).badge_ids
        }
    }

    #[view]
    public fun get_admin(): address acquires BadgeRegistry {
        borrow_global<BadgeRegistry>(@swap_router).admin
    }
}