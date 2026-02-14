module swap_router::badges {
    use std::signer;
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use aptos_framework::type_info;
    use aptos_framework::aptos_coin;
    use aptos_std::table;

    /// Error codes
    const E_NOT_ADMIN: u64 = 1;
    const E_BADGE_NOT_FOUND: u64 = 2;
    const E_ALREADY_MINTED: u64 = 3;
    const E_NOT_ELIGIBLE: u64 = 4;
    const E_BAD_RULE: u64 = 5;
    const E_COIN_TYPE_MISMATCH: u64 = 6;

    /// Rule types
    const RULE_ALLOWLIST: u8 = 1;
    const RULE_MIN_COIN_BALANCE: u8 = 2;
    const RULE_OFFCHAIN_ALLOWLIST: u8 = 3;

    struct BadgeMetadata has store, drop {
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
    }

    struct BadgeDefinition has store, drop {
        id: u64,
        metadata: BadgeMetadata,
        rule_type: u8,
        rule_note: vector<u8>,
        min_balance: u64,
        coin_type: type_info::TypeInfo,
        coin_type_str: vector<u8>,
        created_at: u64,
        updated_at: u64,
    }

    struct BadgeAllowlist has store {
        entries: table::Table<address, bool>,
    }

    struct BadgeRegistry has key {
        admin: address,
        next_id: u64,
        badge_ids: vector<u64>,
        badges: table::Table<u64, BadgeDefinition>,
        allowlists: table::Table<u64, BadgeAllowlist>,
    }

    struct BadgeInstance has store, drop {
        badge_id: u64,
        minted_at: u64,
    }

    struct BadgeStore has key {
        owner: address,
        badges: table::Table<u64, BadgeInstance>,
    }

    /// Initialize badge registry at the module address
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        move_to(admin, BadgeRegistry {
            admin: admin_addr,
            next_id: 1,
            badge_ids: vector::empty<u64>(),
            badges: table::new<u64, BadgeDefinition>(admin_addr),
            allowlists: table::new<u64, BadgeAllowlist>(admin_addr),
        });
    }

    /// Update admin address
    public entry fun set_admin(admin: &signer, new_admin: address) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        registry.admin = new_admin;
    }

    /// Create a badge with allowlist-based eligibility
    public entry fun create_badge_allowlist(
        admin: &signer,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        rule_type: u8,
        rule_note: vector<u8>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(rule_type == RULE_ALLOWLIST || rule_type == RULE_OFFCHAIN_ALLOWLIST, E_BAD_RULE);

        let badge_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        vector::push_back(&mut registry.badge_ids, badge_id);

        let now = timestamp::now_seconds();
        let metadata = BadgeMetadata {
            name,
            description,
            image_uri,
            metadata_uri,
            metadata_hash,
        };

        let definition = BadgeDefinition {
            id: badge_id,
            metadata,
            rule_type,
            rule_note,
            min_balance: 0,
            coin_type: type_info::type_of<aptos_coin::AptosCoin>(),
            coin_type_str: b"",
            created_at: now,
            updated_at: now,
        };

        let allowlist = BadgeAllowlist { entries: table::new<address, bool>(admin_addr) };
        table::add(&mut registry.badges, badge_id, definition);
        table::add(&mut registry.allowlists, badge_id, allowlist);
    }

    /// Create a badge with minimum coin balance eligibility
    public entry fun create_badge_min_balance<CoinType>(
        admin: &signer,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        coin_type_str: vector<u8>,
        min_balance: u64,
        rule_note: vector<u8>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);

        let badge_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        vector::push_back(&mut registry.badge_ids, badge_id);

        let now = timestamp::now_seconds();
        let metadata = BadgeMetadata {
            name,
            description,
            image_uri,
            metadata_uri,
            metadata_hash,
        };

        let definition = BadgeDefinition {
            id: badge_id,
            metadata,
            rule_type: RULE_MIN_COIN_BALANCE,
            rule_note,
            min_balance,
            coin_type: type_info::type_of<CoinType>(),
            coin_type_str,
            created_at: now,
            updated_at: now,
        };

        let allowlist = BadgeAllowlist { entries: table::new<address, bool>(admin_addr) };
        table::add(&mut registry.badges, badge_id, definition);
        table::add(&mut registry.allowlists, badge_id, allowlist);
    }

    /// Update badge metadata (admin only)
    public entry fun update_badge_metadata(
        admin: &signer,
        badge_id: u64,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        metadata_hash: vector<u8>,
        rule_note: vector<u8>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let now = timestamp::now_seconds();
        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        badge.metadata = BadgeMetadata { name, description, image_uri, metadata_uri, metadata_hash };
        badge.rule_note = rule_note;
        badge.updated_at = now;
    }

    /// Update minimum balance for a badge
    public entry fun update_min_balance(
        admin: &signer,
        badge_id: u64,
        min_balance: u64,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.rule_type == RULE_MIN_COIN_BALANCE, E_BAD_RULE);
        badge.min_balance = min_balance;
        badge.updated_at = timestamp::now_seconds();
    }

    /// Add allowlist entries (admin only)
    public entry fun add_allowlist_entries(
        admin: &signer,
        badge_id: u64,
        entries: vector<address>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.allowlists, badge_id), E_BADGE_NOT_FOUND);

        let allowlist = table::borrow_mut(&mut registry.allowlists, badge_id);
        let i = 0;
        let len = vector::length(&entries);
        while (i < len) {
            let addr = *vector::borrow(&entries, i);
            if (!table::contains(&allowlist.entries, addr)) {
                table::add(&mut allowlist.entries, addr, true);
            } else {
                table::remove(&mut allowlist.entries, addr);
                table::add(&mut allowlist.entries, addr, true);
            };
            i = i + 1;
        };
    }

    /// Remove allowlist entries (admin only)
    public entry fun remove_allowlist_entries(
        admin: &signer,
        badge_id: u64,
        entries: vector<address>,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.allowlists, badge_id), E_BADGE_NOT_FOUND);

        let allowlist = table::borrow_mut(&mut registry.allowlists, badge_id);
        let i = 0;
        let len = vector::length(&entries);
        while (i < len) {
            let addr = *vector::borrow(&entries, i);
            if (table::contains(&allowlist.entries, addr)) {
                table::remove(&mut allowlist.entries, addr);
            };
            i = i + 1;
        };
    }

    /// Mint an allowlist-based badge (SBT)
    public entry fun mint(user: &signer, badge_id: u64) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow(&registry.badges, badge_id);
        assert!(badge.rule_type == RULE_ALLOWLIST || badge.rule_type == RULE_OFFCHAIN_ALLOWLIST, E_BAD_RULE);

        let allowlist = table::borrow(&registry.allowlists, badge_id);
        assert!(table::contains(&allowlist.entries, user_addr), E_NOT_ELIGIBLE);

        ensure_badge_store(user);
        let store = borrow_global_mut<BadgeStore>(user_addr);
        assert!(!table::contains(&store.badges, badge_id), E_ALREADY_MINTED);

        let instance = BadgeInstance { badge_id, minted_at: timestamp::now_seconds() };
        table::add(&mut store.badges, badge_id, instance);
    }

    /// Mint a badge with minimum coin balance eligibility (SBT)
    public entry fun mint_with_balance<CoinType>(
        user: &signer,
        badge_id: u64,
    ) acquires BadgeRegistry, BadgeStore {
        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let badge = table::borrow(&registry.badges, badge_id);
        assert!(badge.rule_type == RULE_MIN_COIN_BALANCE, E_BAD_RULE);
        assert!(type_info::equals(&badge.coin_type, &type_info::type_of<CoinType>()), E_COIN_TYPE_MISMATCH);

        let balance = coin::balance<CoinType>(user_addr);
        assert!(balance >= badge.min_balance, E_NOT_ELIGIBLE);

        ensure_badge_store(user);
        let store = borrow_global_mut<BadgeStore>(user_addr);
        assert!(!table::contains(&store.badges, badge_id), E_ALREADY_MINTED);

        let instance = BadgeInstance { badge_id, minted_at: timestamp::now_seconds() };
        table::add(&mut store.badges, badge_id, instance);
    }

    #[view]
    public fun get_badge_ids(): vector<u64> acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        copy_u64_vec(&registry.badge_ids)
    }

    #[view]
    public fun get_badge(badge_id: u64): (u64, vector<u8>, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u8, vector<u8>, u64, vector<u8>, u64, u64) acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow(&registry.badges, badge_id);
        (
            badge.id,
            copy_bytes(&badge.metadata.name),
            copy_bytes(&badge.metadata.description),
            copy_bytes(&badge.metadata.image_uri),
            copy_bytes(&badge.metadata.metadata_uri),
            copy_bytes(&badge.metadata.metadata_hash),
            badge.rule_type,
            copy_bytes(&badge.rule_note),
            badge.min_balance,
            copy_bytes(&badge.coin_type_str),
            badge.created_at,
            badge.updated_at,
        )
    }

    #[view]
    public fun has_badge(owner: address, badge_id: u64): bool acquires BadgeStore {
        if (!exists<BadgeStore>(owner)) {
            return false;
        };
        let store = borrow_global<BadgeStore>(owner);
        table::contains(&store.badges, badge_id)
    }

    #[view]
    public fun is_allowlisted(owner: address, badge_id: u64): bool acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        if (!table::contains(&registry.allowlists, badge_id)) {
            return false;
        };
        let allowlist = table::borrow(&registry.allowlists, badge_id);
        table::contains(&allowlist.entries, owner)
    }

    fun copy_bytes(data: &vector<u8>): vector<u8> {
        let result = vector::empty<u8>();
        let i = 0;
        let len = vector::length(data);
        while (i < len) {
            vector::push_back(&mut result, *vector::borrow(data, i));
            i = i + 1;
        };
        result
    }

    fun copy_u64_vec(data: &vector<u64>): vector<u64> {
        let result = vector::empty<u64>();
        let i = 0;
        let len = vector::length(data);
        while (i < len) {
            vector::push_back(&mut result, *vector::borrow(data, i));
            i = i + 1;
        };
        result
    }

    fun ensure_badge_store(user: &signer) {
        let user_addr = signer::address_of(user);
        if (!exists<BadgeStore>(user_addr)) {
            move_to(user, BadgeStore {
                owner: user_addr,
                badges: table::new<u64, BadgeInstance>(user_addr),
            });
        };
    }
}
