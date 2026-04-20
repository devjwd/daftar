module swap_router::badges {
    use std::bcs;
    use std::option;
    use std::signer;
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use aptos_framework::aptos_coin;
    use aptos_std::table::{Self, Table};
    use aptos_framework::event;
    use aptos_std::ed25519;

    // --- ERROR CODES ---
    const E_NOT_ADMIN: u64            = 1;
    const E_BADGE_NOT_FOUND: u64      = 2;
    const E_ALREADY_MINTED: u64       = 3;
    const E_BADGE_PAUSED: u64         = 4;
    const E_SUPPLY_REACHED: u64       = 5;
    const E_INSUFFICIENT_FEE: u64     = 6;
    const E_INVALID_SIGNATURE: u64    = 7;
    const E_REGISTRY_PAUSED: u64      = 8;
    const E_BAD_ADMIN_ADDRESS: u64    = 9;
    const E_NOT_PENDING_ADMIN: u64    = 10;
    const E_FEE_TREASURY_NOT_SET: u64 = 11;
    const E_INVALID_TIME_RANGE: u64   = 12;
    const E_INVALID_PUB_KEY: u64      = 13;
    const E_SIGNATURE_EXPIRED: u64    = 14;
    const E_BADGE_NOT_STARTED: u64    = 15;
    const E_BADGE_EXPIRED: u64        = 16;
    const E_INVALID_RARITY: u64       = 17;
    const E_FIELD_TOO_LONG: u64       = 18;
    const E_INVALID_TREASURY: u64     = 19;
    const E_BADGE_NOT_PAUSED: u64     = 20;
    const E_BADGE_NOT_ACTIVE: u64     = 21;
    const E_TOO_MANY_BADGES_GLOBAL: u64 = 22;
    const E_TOO_MANY_BADGES_PER_USER: u64 = 23;
    const E_SIGNATURE_WINDOW_TOO_LARGE: u64 = 24;
    const E_BADGE_ALREADY_DISCONTINUED: u64 = 25;

    // --- CONSTANTS ---
    const STATUS_ACTIVE: u8       = 1;
    const STATUS_PAUSED: u8       = 2;
    const STATUS_DISCONTINUED: u8 = 3;

    const PUB_KEY_LEN: u64   = 32;
    const SIG_LEN: u64       = 64;
    const MAX_FIELD_LEN: u64 = 1024;
    const MAX_RARITY: u8     = 5;
    const MAX_BADGES_GLOBAL: u64 = 100_000;
    const MAX_BADGES_PER_USER: u64 = 10_000;
    const MAX_SIG_VALIDITY_SECS: u64 = 300;
    const MINT_DOMAIN_SEPARATOR: vector<u8> = b"movement.badges.mint.v1";

    // --- STRUCTS ---

    struct BadgeMetadata has store, drop, copy {
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
    }

    struct BadgeDefinition has store, drop {
        id: u64,
        metadata: BadgeMetadata,
        status: u8,
        starts_at: u64,
        ends_at: u64,
        created_at: u64,
        mint_fee: u64,
        total_minted: u64,
        max_supply: u64,
    }

    struct BadgeRegistry has key {
        admin: address,
        pending_admin: address,
        signer_pub_key: vector<u8>,
        signer_epoch: u64,
        paused: bool,
        fee_treasury: address,
        next_id: u64,
        badge_ids: vector<u64>,
        badges: Table<u64, BadgeDefinition>,
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

    #[event]
    struct BadgeCreated has drop, store {
        badge_id: u64, name: vector<u8>, mint_fee: u64, admin: address, timestamp: u64
    }

    #[event]
    struct BadgeMinted has drop, store {
        badge_id: u64, recipient: address, timestamp: u64
    }

    #[event]
    struct BadgeFeePaid has drop, store {
        badge_id: u64, payer: address, amount: u64, treasury: address, timestamp: u64
    }

    #[event]
    struct BadgeDiscontinued has drop, store {
        badge_id: u64, admin: address, timestamp: u64
    }

    #[event]
    struct PubKeyUpdated has drop, store {
        admin: address, timestamp: u64
    }

    #[event]
    struct FeeTreasuryUpdated has drop, store {
        old_treasury: address, new_treasury: address, admin: address, timestamp: u64
    }

    #[event]
    struct AdminTransferInitiated has drop, store {
        current_admin: address, pending_admin: address, timestamp: u64
    }

    #[event]
    struct AdminTransferAccepted has drop, store {
        old_admin: address, new_admin: address, timestamp: u64
    }

    #[event]
    struct RegistryPauseUpdated has drop, store {
        admin: address, paused: bool, timestamp: u64
    }

    #[event]
    struct BadgeStatusUpdated has drop, store {
        badge_id: u64, status: u8, admin: address, timestamp: u64
    }

    // --- PRIVATE HELPERS ---

    fun assert_valid_pub_key(key: &vector<u8>) {
        assert!(vector::length(key) == PUB_KEY_LEN, E_INVALID_PUB_KEY);
        let opt = ed25519::new_validated_public_key_from_bytes(*key);
        assert!(option::is_some(&opt), E_INVALID_PUB_KEY);
    }

    // --- INITIALIZATION ---

    public entry fun initialize(
        admin: &signer,
        signer_pub_key: vector<u8>,
        fee_treasury: address,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @swap_router, E_BAD_ADMIN_ADDRESS);
        assert!(fee_treasury != @0x0, E_INVALID_TREASURY);
        assert_valid_pub_key(&signer_pub_key);

        move_to(admin, BadgeRegistry {
            admin: admin_addr,
            pending_admin: @0x0,
            signer_pub_key,
            signer_epoch: 0,
            paused: false,
            fee_treasury,
            next_id: 1,
            badge_ids: vector::empty<u64>(),
            badges: table::new(),
        });
    }

    // --- CORE LOGIC ---

    public entry fun create_badge(
        admin: &signer,
        name: vector<u8>,
        description: vector<u8>,
        image_uri: vector<u8>,
        metadata_uri: vector<u8>,
        category: vector<u8>,
        rarity: u8,
        xp_value: u64,
        starts_at: u64,
        ends_at: u64,
        max_supply: u64,
        mint_fee: u64,
    ) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);

        assert!(vector::length(&name)         <= MAX_FIELD_LEN, E_FIELD_TOO_LONG);
        assert!(vector::length(&description)  <= MAX_FIELD_LEN, E_FIELD_TOO_LONG);
        assert!(vector::length(&image_uri)    <= MAX_FIELD_LEN, E_FIELD_TOO_LONG);
        assert!(vector::length(&metadata_uri) <= MAX_FIELD_LEN, E_FIELD_TOO_LONG);
        assert!(vector::length(&category)     <= MAX_FIELD_LEN, E_FIELD_TOO_LONG);

        assert!(rarity >= 1 && rarity <= MAX_RARITY, E_INVALID_RARITY);

        let now = timestamp::now_seconds();

        if (starts_at > 0 && ends_at > 0) {
            assert!(ends_at > starts_at, E_INVALID_TIME_RANGE);
        };
        if (ends_at > 0) {
            assert!(ends_at > now, E_INVALID_TIME_RANGE);
        };

        let badge_id = registry.next_id;
        registry.next_id = registry.next_id + 1;
        assert!(vector::length(&registry.badge_ids) < MAX_BADGES_GLOBAL, E_TOO_MANY_BADGES_GLOBAL);
        vector::push_back(&mut registry.badge_ids, badge_id);

        let metadata = BadgeMetadata {
            name: copy name,
            description,
            image_uri,
            metadata_uri,
            category,
            rarity,
            xp_value,
        };

        let definition = BadgeDefinition {
            id: badge_id,
            metadata,
            status: STATUS_ACTIVE,
            starts_at,
            ends_at,
            created_at: now,
            mint_fee,
            total_minted: 0,
            max_supply,
        };

        table::add(&mut registry.badges, badge_id, definition);
        event::emit(BadgeCreated { badge_id, name, mint_fee, admin: admin_addr, timestamp: now });
    }

    /// Primary mint function. Requires a valid, non-expired Ed25519 signature from the backend.
    ///
    /// Signed message (BCS, little-endian):
    ///   domain || module_addr (32 bytes) || user_addr (32 bytes)
    ///   || badge_id (8 bytes) || valid_until (8 bytes) || signer_epoch (8 bytes)
    public entry fun mint(
        user: &signer,
        badge_id: u64,
        valid_until: u64,
        signature_bytes: vector<u8>,
    ) acquires BadgeRegistry, BadgeStore {
        assert!(vector::length(&signature_bytes) == SIG_LEN, E_INVALID_SIGNATURE);

        let now = timestamp::now_seconds();
        assert!(now <= valid_until, E_SIGNATURE_EXPIRED);
        assert!(valid_until - now <= MAX_SIG_VALIDITY_SECS, E_SIGNATURE_WINDOW_TOO_LARGE);

        let user_addr = signer::address_of(user);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(!registry.paused, E_REGISTRY_PAUSED);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);

        let message = copy MINT_DOMAIN_SEPARATOR;
        vector::append(&mut message, bcs::to_bytes(&@swap_router));
        vector::append(&mut message, bcs::to_bytes(&user_addr));
        vector::append(&mut message, bcs::to_bytes(&badge_id));
        vector::append(&mut message, bcs::to_bytes(&valid_until));
        vector::append(&mut message, bcs::to_bytes(&registry.signer_epoch));

        let pub_key_opt = ed25519::new_validated_public_key_from_bytes(registry.signer_pub_key);
        assert!(option::is_some(&pub_key_opt), E_INVALID_PUB_KEY);
        let val_pub_key = option::extract(&mut pub_key_opt);
        let pub_key = ed25519::public_key_to_unvalidated(&val_pub_key);
        let signature = ed25519::new_signature_from_bytes(signature_bytes);
        assert!(ed25519::signature_verify_strict(&signature, &pub_key, message), E_INVALID_SIGNATURE);

        let badge_mut = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge_mut.status == STATUS_ACTIVE, E_BADGE_PAUSED);
        if (badge_mut.starts_at > 0) assert!(now >= badge_mut.starts_at, E_BADGE_NOT_STARTED);
        if (badge_mut.ends_at > 0)   assert!(now <= badge_mut.ends_at,   E_BADGE_EXPIRED);
        if (badge_mut.max_supply > 0) assert!(badge_mut.total_minted < badge_mut.max_supply, E_SUPPLY_REACHED);

        ensure_badge_store(user);
        let store = borrow_global_mut<BadgeStore>(user_addr);
        assert!(!table::contains(&store.badges, badge_id), E_ALREADY_MINTED);
        assert!(vector::length(&store.badge_ids) < MAX_BADGES_PER_USER, E_TOO_MANY_BADGES_PER_USER);

        if (badge_mut.mint_fee > 0) {
            assert!(registry.fee_treasury != @0x0, E_FEE_TREASURY_NOT_SET);
            assert!(coin::balance<aptos_coin::AptosCoin>(user_addr) >= badge_mut.mint_fee, E_INSUFFICIENT_FEE);
            coin::transfer<aptos_coin::AptosCoin>(user, registry.fee_treasury, badge_mut.mint_fee);
            event::emit(BadgeFeePaid {
                badge_id,
                payer: user_addr,
                amount: badge_mut.mint_fee,
                treasury: registry.fee_treasury,
                timestamp: now,
            });
        };

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

    // --- ADMIN CONTROLS ---

    public entry fun update_signer_pub_key(admin: &signer, new_pub_key: vector<u8>) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert_valid_pub_key(&new_pub_key);
        registry.signer_pub_key = new_pub_key;
        registry.signer_epoch = registry.signer_epoch + 1;
        event::emit(PubKeyUpdated { admin: admin_addr, timestamp: timestamp::now_seconds() });
    }

    public entry fun update_fee_treasury(admin: &signer, new_treasury: address) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(new_treasury != @0x0, E_INVALID_TREASURY);
        let old_treasury = registry.fee_treasury;
        registry.fee_treasury = new_treasury;
        event::emit(FeeTreasuryUpdated {
            old_treasury,
            new_treasury,
            admin: admin_addr,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun initiate_admin_transfer(admin: &signer, new_admin: address) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(new_admin != @0x0, E_BAD_ADMIN_ADDRESS);
        registry.pending_admin = new_admin;
        event::emit(AdminTransferInitiated {
            current_admin: admin_addr,
            pending_admin: new_admin,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun accept_admin_transfer(new_admin: &signer) acquires BadgeRegistry {
        let new_admin_addr = signer::address_of(new_admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(new_admin_addr == registry.pending_admin, E_NOT_PENDING_ADMIN);
        let old_admin = registry.admin;
        registry.admin = new_admin_addr;
        registry.pending_admin = @0x0;
        event::emit(AdminTransferAccepted {
            old_admin,
            new_admin: new_admin_addr,
            timestamp: timestamp::now_seconds(),
        });
    }

    public entry fun set_paused(admin: &signer, is_paused: bool) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        registry.paused = is_paused;
        event::emit(RegistryPauseUpdated { admin: admin_addr, paused: is_paused, timestamp: timestamp::now_seconds() });
    }

    public entry fun pause_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status == STATUS_ACTIVE, E_BADGE_NOT_ACTIVE);
        badge.status = STATUS_PAUSED;
        event::emit(BadgeStatusUpdated { badge_id, status: STATUS_PAUSED, admin: admin_addr, timestamp: timestamp::now_seconds() });
    }

    public entry fun resume_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status == STATUS_PAUSED, E_BADGE_NOT_PAUSED);
        badge.status = STATUS_ACTIVE;
        event::emit(BadgeStatusUpdated { badge_id, status: STATUS_ACTIVE, admin: admin_addr, timestamp: timestamp::now_seconds() });
    }

    public entry fun discontinue_badge(admin: &signer, badge_id: u64) acquires BadgeRegistry {
        let admin_addr = signer::address_of(admin);
        let registry = borrow_global_mut<BadgeRegistry>(@swap_router);
        assert!(admin_addr == registry.admin, E_NOT_ADMIN);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow_mut(&mut registry.badges, badge_id);
        assert!(badge.status != STATUS_DISCONTINUED, E_BADGE_ALREADY_DISCONTINUED);
        badge.status = STATUS_DISCONTINUED;
        event::emit(BadgeDiscontinued { badge_id, admin: admin_addr, timestamp: timestamp::now_seconds() });
    }

    // --- VIEW FUNCTIONS ---

    #[view]
    public fun has_badge(owner: address, badge_id: u64): bool acquires BadgeStore {
        if (!exists<BadgeStore>(owner)) return false;
        let store = borrow_global<BadgeStore>(owner);
        table::contains(&store.badges, badge_id)
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
    public fun get_user_badge_ids_paginated(owner: address, start: u64, limit: u64): vector<u64> acquires BadgeStore {
        let out = vector::empty<u64>();
        if (!exists<BadgeStore>(owner) || limit == 0) {
            return out
        };

        let ids_ref = &borrow_global<BadgeStore>(owner).badge_ids;
        let len = vector::length(ids_ref);
        if (start >= len) {
            return out
        };

        let remaining = len - start;
        let take = if (limit > remaining) { remaining } else { limit };
        let end = start + take;
        let i = start;
        while (i < end) {
            vector::push_back(&mut out, *vector::borrow(ids_ref, i));
            i = i + 1;
        };

        out
    }

    #[view]
    public fun get_badge_info(badge_id: u64): (vector<u8>, vector<u8>, u8, u64, u64, u64, u64, u64, u64) acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        assert!(table::contains(&registry.badges, badge_id), E_BADGE_NOT_FOUND);
        let badge = table::borrow(&registry.badges, badge_id);
        (
            *&badge.metadata.name,
            *&badge.metadata.category,
            badge.status,
            badge.mint_fee,
            badge.total_minted,
            badge.max_supply,
            badge.metadata.xp_value,
            badge.starts_at,
            badge.ends_at,
        )
    }

    #[view]
    public fun get_registry_info(): (address, address, bool, address, u64) acquires BadgeRegistry {
        let registry = borrow_global<BadgeRegistry>(@swap_router);
        (
            registry.admin,
            registry.pending_admin,
            registry.paused,
            registry.fee_treasury,
            registry.next_id,
        )
    }

    #[view]
    public fun get_signer_epoch(): u64 acquires BadgeRegistry {
        borrow_global<BadgeRegistry>(@swap_router).signer_epoch
    }
}
