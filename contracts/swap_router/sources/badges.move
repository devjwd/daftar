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
    const E_REGISTRY_PAUSED: u64 = 20;

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
        paused: bool,
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
    #[event] struct AdminTransferInitiated has drop, store { current_admin: address, pending_admin: address, timestamp: u64 }
    #[event] struct AdminTransferCompleted has drop, store { old_admin: address, new_admin: address, timestamp: u64 }
    #[event] struct RegistryPauseUpdated has drop, store { admin: address, paused: bool, timestamp: u64 }

    // --- INITIALIZATION ---
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @swap_router, E_BAD_ADMIN_ADDRESS);
        assert!(!exists<BadgeRegistry>(@swap_router), E_REGISTRY_ALREADY_EXISTS);
        
        move_to(admin, BadgeRegistry {
            admin: admin_addr,
            pending_admin: @0x0,
            paused: false,
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
        assert!(rule_type != RULE_MIN_BALANCE, E_BAD_RULE);

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

    public entry fun create_badge_min_balance<CoinType>(
        admin: &signer,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
        coin_type_str: vector<u8>,
        min_balance: u64,
        rule_note: vector<u8>,
        starts_at: u64,
        ends_at: u64,
        max_supply: u64,
        mint_fee: u64,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);

        if (starts_at > 0 && ends_at > 0) assert!(ends_at > starts_at, E_INVALID_TIME_RANGE);

        let badge_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        vector::push_back(&mut registry.badge_ids, badge_id);

        let now = timestamp::now_seconds();

        let metadata = BadgeMetadata { name: copy name, description, image_uri, metadata_uri, metadata_hash, category, rarity, xp_value };
        let rule_params = RuleParams {
            min_value: min_balance,
            coin_type: type_info::type_of<CoinType>(),
            coin_type_str,
            dapp_address: b"",
            extra_data: b"",
        };

        let definition = BadgeDefinition {
            id: badge_id, metadata, rule_type: RULE_MIN_BALANCE, rule_params, rule_note,
            status: STATUS_ACTIVE, starts_at, ends_at,
            created_at: now, updated_at: now, paused_at: 0, discontinued_at: 0,
            mint_fee,
            total_minted: 0, max_supply
        };

        table::add(&mut registry.badges, badge_id, definition);
        table::add(&mut registry.allowlists, badge_id, BadgeAllowlist { entries: table::new() });

        event::emit(BadgeCreated { badge_id, name, rule_type: RULE_MIN_BALANCE, mint_fee, admin: admin_addr, timestamp: now });
    }

    public entry fun mint(user: &signer, badge_id: u64) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(!registry.paused, E_REGISTRY_PAUSED);
        
        // 1. Validate existence and global eligibility
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge_ref = table::borrow(&registry.badges, badge_id);
        validate_mint_eligibility(badge_ref);

        // 2. Validate rule specifics.
        if (badge_ref.rule_type == RULE_ALLOWLIST || badge_ref.rule_type == RULE_ATTESTATION) {
            let allowlist = table::borrow(&registry.allowlists, badge_id);
            assert!(table::contains(&allowlist.entries, user_addr), E_NOT_ELIGIBLE);
        } else {
            // Min-balance badges must be minted through mint_with_balance<CoinType>.
            assert!(badge_ref.rule_type != RULE_MIN_BALANCE, E_BAD_RULE);
        };

        // 3. Process Mint
        execute_mint(user, registry, badge_id);
    }

    public entry fun mint_with_balance<CoinType>(user: &signer, badge_id: u64) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(!registry.paused, E_REGISTRY_PAUSED);
        
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

    public entry fun transfer_admin(
        admin: &signer,
        new_admin: address,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(new_admin != @0x0, E_BAD_ADMIN_ADDRESS);
        assert!(new_admin != admin_addr, E_BAD_ADMIN_ADDRESS);

        registry.pending_admin = new_admin;
        event::emit(AdminTransferInitiated {
            current_admin: admin_addr,
            pending_admin: new_admin,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun accept_admin(new_admin: &signer) acquires BadgeRegistry {
        let new_admin_addr = signer::address_of(new_admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(new_admin_addr == registry.pending_admin, E_NOT_PENDING_ADMIN);

        let old_admin = registry.admin;
        registry.admin = new_admin_addr;
        registry.pending_admin = @0x0;

        event::emit(AdminTransferCompleted {
            old_admin,
            new_admin: new_admin_addr,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun cancel_admin_transfer(admin: &signer) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        registry.pending_admin = @0x0;
    }

    public entry fun set_paused(admin: &signer, is_paused: bool) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);

        registry.paused = is_paused;
        event::emit(RegistryPauseUpdated {
            admin: admin_addr,
            paused: is_paused,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun update_badge_metadata(
        admin: &signer,
        badge_id: u64,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
        rule_note: vector<u8>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        badge.metadata.name = name;
        badge.metadata.description = description;
        badge.metadata.image_uri = image_uri;
        badge.metadata.metadata_uri = metadata_uri;
        badge.metadata.metadata_hash = metadata_hash;
        badge.metadata.category = category;
        badge.metadata.rarity = rarity;
        badge.metadata.xp_value = xp_value;
        badge.rule_note = rule_note;
        badge.updated_at = timestamp::now_seconds();
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
        assert!(badge.status == STATUS_PAUSED, E_BADGE_ALREADY_ACTIVE);

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
        (!registry.paused) &&
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

    #[view]
    public fun get_pending_admin(): address acquires BadgeRegistry {
        borrow_global<BadgeRegistry>(@swap_router).pending_admin
    }

    #[view]
    public fun is_paused(): bool acquires BadgeRegistry {
        borrow_global<BadgeRegistry>(@swap_router).paused
    }

    // =========================================================================
    // Tests
    // =========================================================================

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::coin::MintCapability;
    #[test_only]
    use std::string;

    #[test_only]
    fun setup_test(admin: &signer, framework: &signer): MintCapability<aptos_coin::AptosCoin> {
        timestamp::set_time_has_started_for_testing(framework);
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<aptos_coin::AptosCoin>(
            framework,
            string::utf8(b"AptosCoin"),
            string::utf8(b"APT"),
            8,
            true,
        );
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_freeze_cap(freeze_cap);

        account::create_account_for_test(signer::address_of(admin));
        coin::register<aptos_coin::AptosCoin>(admin);
        mint_cap
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_initialize(admin: &signer, framework: &signer) acquires BadgeRegistry {
        let mint_cap = setup_test(admin, framework);
        initialize(admin);

        assert!(get_admin() == @swap_router, 1);
        assert!(get_pending_admin() == @0x0, 2);
        assert!(!is_paused(), 3);

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, framework = @0x1)]
    public fun test_create_badge(admin: &signer, framework: &signer) acquires BadgeRegistry {
        let mint_cap = setup_test(admin, framework);
        initialize(admin);

        create_badge(
            admin,
            b"Genesis",
            b"First badge",
            b"https://img",
            b"https://meta",
            b"hash",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"allowlist",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            0,
        );

        let ids = get_badge_ids();
        assert!(vector::length(&ids) == 1, 1);
        assert!(*vector::borrow(&ids, 0) == 1, 2);

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, framework = @0x1)]
    public fun test_mint_allowlist(admin: &signer, user: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        initialize(admin);

        create_badge(
            admin,
            b"Allowlisted",
            b"",
            b"",
            b"",
            b"",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            0,
        );

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user));
        add_allowlist_entries(admin, 1, addresses);

        mint(user, 1);
        assert!(has_badge(signer::address_of(user), 1), 1);

        let (total_minted, _, _) = get_badge_stats(1);
        assert!(total_minted == 1, 2);

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, framework = @0x1)]
    #[expected_failure(abort_code = E_ALREADY_MINTED)]
    public fun test_mint_already_minted(admin: &signer, user: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        initialize(admin);

        create_badge(
            admin,
            b"Single",
            b"",
            b"",
            b"",
            b"",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            0,
        );

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user));
        add_allowlist_entries(admin, 1, addresses);

        mint(user, 1);
        mint(user, 1);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, framework = @0x1)]
    #[expected_failure(abort_code = E_BADGE_PAUSED)]
    public fun test_mint_paused(admin: &signer, user: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        initialize(admin);

        create_badge(
            admin,
            b"Pausable",
            b"",
            b"",
            b"",
            b"",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            0,
        );

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user));
        add_allowlist_entries(admin, 1, addresses);

        pause_badge(admin, 1);
        mint(user, 1);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user1 = @0xB0B, user2 = @0xCAFE, framework = @0x1)]
    #[expected_failure(abort_code = E_SUPPLY_REACHED)]
    public fun test_supply_cap(admin: &signer, user1: &signer, user2: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user1));
        account::create_account_for_test(signer::address_of(user2));
        initialize(admin);

        create_badge(
            admin,
            b"Limited",
            b"",
            b"",
            b"",
            b"",
            b"special",
            3,
            50,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            1,
            0,
        );

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user1));
        vector::push_back(&mut addresses, signer::address_of(user2));
        add_allowlist_entries(admin, 1, addresses);

        mint(user1, 1);
        mint(user2, 1);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, treasury = @0x999, framework = @0x1)]
    public fun test_fee_collection(admin: &signer, user: &signer, treasury: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        account::create_account_for_test(signer::address_of(treasury));
        coin::register<aptos_coin::AptosCoin>(user);
        coin::register<aptos_coin::AptosCoin>(treasury);
        initialize(admin);

        set_fee_treasury(admin, signer::address_of(treasury));

        create_badge(
            admin,
            b"Paid",
            b"",
            b"",
            b"",
            b"",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            10_000_000,
        );

        let funding = coin::mint(100_000_000, &mint_cap);
        coin::deposit(signer::address_of(user), funding);

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user));
        add_allowlist_entries(admin, 1, addresses);

        let treasury_before = coin::balance<aptos_coin::AptosCoin>(signer::address_of(treasury));
        mint(user, 1);
        let treasury_after = coin::balance<aptos_coin::AptosCoin>(signer::address_of(treasury));
        assert!(treasury_after - treasury_before == 10_000_000, 1);

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, framework = @0x1)]
    #[expected_failure(abort_code = E_REGISTRY_PAUSED)]
    public fun test_global_pause_blocks_mint(admin: &signer, user: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        initialize(admin);

        create_badge(
            admin,
            b"GlobalPause",
            b"",
            b"",
            b"",
            b"",
            b"activity",
            1,
            10,
            RULE_ALLOWLIST,
            b"",
            0,
            b"",
            b"",
            b"",
            0,
            0,
            0,
            0,
        );

        let addresses = vector::empty<address>();
        vector::push_back(&mut addresses, signer::address_of(user));
        add_allowlist_entries(admin, 1, addresses);

        set_paused(admin, true);
        mint(user, 1);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, new_admin = @0xBEEF, framework = @0x1)]
    public fun test_admin_transfer(admin: &signer, new_admin: &signer, framework: &signer) acquires BadgeRegistry {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(new_admin));
        initialize(admin);

        transfer_admin(admin, signer::address_of(new_admin));
        assert!(get_pending_admin() == signer::address_of(new_admin), 1);

        accept_admin(new_admin);
        assert!(get_admin() == signer::address_of(new_admin), 2);
        assert!(get_pending_admin() == @0x0, 3);

        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @swap_router, user = @0xB0B, framework = @0x1)]
    public fun test_create_and_mint_min_balance_badge(admin: &signer, user: &signer, framework: &signer) acquires BadgeRegistry, BadgeStore {
        let mint_cap = setup_test(admin, framework);
        account::create_account_for_test(signer::address_of(user));
        coin::register<aptos_coin::AptosCoin>(user);
        initialize(admin);

        create_badge_min_balance<aptos_coin::AptosCoin>(
            admin,
            b"Whale",
            b"",
            b"",
            b"",
            b"",
            b"defi",
            2,
            25,
            b"0x1::aptos_coin::AptosCoin",
            50_000_000,
            b"min-balance",
            0,
            0,
            0,
            0,
        );

        let funding = coin::mint(100_000_000, &mint_cap);
        coin::deposit(signer::address_of(user), funding);

        mint_with_balance<aptos_coin::AptosCoin>(user, 1);
        assert!(has_badge(signer::address_of(user), 1), 1);

        coin::destroy_mint_cap(mint_cap);
    }
}