/// =============================================================================
/// Yuzu Wrapper Module
/// =============================================================================
/// This module wraps Yuzu swaps and extracts the partner fee to the treasury
/// before forwarding the remainder to the Yuzu router.
/// 
/// Note: To compile this module, you must add `yuzu` as a dependency in your Move.toml
/// Example: `yuzu = { local = "../path/to/yuzu" }` or git repo.

module swap_router::yuzu_wrapper {
    use std::signer;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::fungible_asset::{Self, FungibleAsset, Metadata};
    use aptos_framework::object::{Self, Object};
    use swap_router::storage;

    // We assume yuzu::router is available as a dependency
    // use yuzu::router;

    const E_INSUFFICIENT_INPUT: u64 = 500;
    const E_SLIPPAGE_ERROR: u64 = 501;

    /// Calculates and extracts fee from input FA, returning the remainder and the fee taken.
    fun extract_fee_fa(input: &mut FungibleAsset, fee_bps: u64, treasury: address): u64 {
        let amount = fungible_asset::amount(input);
        let fee_amount = (amount * fee_bps) / 10000;
        if (fee_amount > 0) {
            let fee_fa = fungible_asset::extract(input, fee_amount);
            fungible_asset::deposit(treasury, fee_fa);
        };
        fee_amount
    }

    /// Public wrapper for Yuzu's FA to FA swap.
    public fun swap_exact_fa_for_fa(
        user: &signer,
        input_fa: FungibleAsset,
        // ... (Yuzu routing arguments here, e.g., pool details)
    ): FungibleAsset {
        // 1. Get configuration
        let (fee_bps, treasury, charge_fee_by, _, paused) = storage::get_partner_config();
        assert!(!paused, 0);

        let initial_amount = fungible_asset::amount(&input_fa);

        // 2. Extract fee (assuming charge_fee_by == token_in)
        let fee_reported = 0;
        if (charge_fee_by == std::string::utf8(b"token_in")) {
            fee_reported = extract_fee_fa(&mut input_fa, fee_bps, treasury);
        };

        // 3. Call Yuzu
        // let output_fa = yuzu::router::swap_exact_fa_for_fa(input_fa, ...);
        let output_fa = input_fa; // Placeholder since we cannot compile without Yuzu

        // 4. Record Swap
        let now = aptos_framework::timestamp::now_microseconds();
        storage::record_global_swap(fee_reported, now);
        storage::record_user_swap(user, initial_amount, fee_reported, now);

        output_fa
    }

    // Additional wrappers like swap_exact_coin_for_coin would follow the exact same pattern.
}
