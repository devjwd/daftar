/// =============================================================================
/// Yuzu Wrapper Module
/// =============================================================================
/// This module wraps Yuzu swaps and extracts the partner fee to the treasury
/// before forwarding the remainder to the Yuzu router.
///
/// Fee extraction supports both charge modes:
///   • "token_in"  — fee deducted from the input FA before the swap.
///   • "token_out" — fee deducted from the output FA after the swap.
///
/// Note: To compile this module, you must add `yuzu` as a dependency in your Move.toml
/// Example: `yuzu = { local = "../path/to/yuzu" }` or git repo.

module swap_router::yuzu_wrapper {
    use std::signer;
    use aptos_framework::fungible_asset::{Self, FungibleAsset};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use swap_router::storage;

    // We assume yuzu::router is available as a dependency
    // use yuzu::router;

    const E_INSUFFICIENT_INPUT: u64 = 500;
    const E_SLIPPAGE_ERROR: u64 = 501;

    /// Calculates and extracts the partner fee from a FungibleAsset (by mutable reference),
    /// depositing the fee into the treasury's primary fungible store.
    ///
    /// Uses u128 intermediate arithmetic to prevent u64 overflow when:
    ///   amount * fee_bps > u64::MAX  (possible at max fee_bps = 500 for very large amounts)
    ///
    /// Returns the fee amount extracted (0 if fee rounds down to zero).
    fun extract_fee_fa(asset: &mut FungibleAsset, fee_bps: u64, treasury: address): u64 {
        let amount = fungible_asset::amount(asset);
        // Promote to u128 before multiplication to prevent overflow.
        let fee_amount = (((amount as u128) * (fee_bps as u128)) / 10000u128) as u64;
        if (fee_amount > 0) {
            let fee_fa = fungible_asset::extract(asset, fee_amount);
            // primary_fungible_store::deposit accepts a plain address and handles
            // store creation if the treasury does not yet have one.
            primary_fungible_store::deposit(treasury, fee_fa);
        };
        fee_amount
    }

    /// Public wrapper for Yuzu's FA-to-FA swap.
    ///
    /// Fee extraction order:
    ///   • "token_in"  → fee extracted from `input_fa` BEFORE calling Yuzu.
    ///   • "token_out" → fee extracted from `output_fa` AFTER Yuzu returns.
    ///
    /// Both paths record the swap in the global and per-user analytics.
    public fun swap_exact_fa_for_fa(
        user: &signer,
        input_fa: FungibleAsset,
        // ... (Yuzu routing arguments here, e.g., pool details, min_amount_out)
    ): FungibleAsset {
        // 1. Read partner configuration — abort if protocol is paused.
        let (fee_bps, treasury, charge_fee_by, _, paused) = storage::get_partner_config();
        assert!(!paused, 0);

        let initial_amount = fungible_asset::amount(&input_fa);
        let fee_reported = 0u64;

        // 2. Deduct fee from input if configured to charge token_in.
        if (charge_fee_by == std::string::utf8(b"token_in")) {
            fee_reported = extract_fee_fa(&mut input_fa, fee_bps, treasury);
        };

        // 3. Forward remainder to Yuzu router.
        // let output_fa = yuzu::router::swap_exact_fa_for_fa(input_fa, ...);
        let output_fa = input_fa; // Placeholder — cannot compile without Yuzu dependency.

        // 4. Deduct fee from output if configured to charge token_out.
        if (charge_fee_by == std::string::utf8(b"token_out")) {
            fee_reported = extract_fee_fa(&mut output_fa, fee_bps, treasury);
        };

        // 5. Record swap analytics — use now_seconds() for consistency with router.move.
        let now = timestamp::now_seconds();
        storage::record_global_swap(fee_reported, now);
        storage::record_user_swap(user, initial_amount, fee_reported, now);

        output_fa
    }

    // Additional wrappers like swap_exact_coin_for_coin follow the same pattern:
    // read config → extract fee (token_in) → call Yuzu → extract fee (token_out) → record.
}
