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
/// ## Slippage handling (IMPORTANT)
///
/// When charge_fee_by == "token_in", the fee is deducted from `input_fa`
/// BEFORE calling Yuzu.  The Yuzu router therefore receives less than the
/// original `amount_in`.  To prevent the Yuzu slippage guard from rejecting
/// the transaction, callers MUST compute `min_amount_out` against the
/// post-fee input (i.e. `amount_after_fee = amount_in - fee`), not the
/// original input.  This module enforces a `min_amount_out` parameter and
/// aborts with `E_SLIPPAGE_EXCEEDED` if Yuzu returns less than that.
///
/// When charge_fee_by == "token_out", the swap runs against the full
/// `amount_in`, so `min_amount_out` should be computed against the full
/// input as usual.  The fee is then deducted from the output, after which
/// the remaining `output_amount - fee` is returned to the caller.
///
/// ## Dependency note
///
/// To compile this module you must add `yuzu` as a dependency in Move.toml:
///   yuzu = { local = "../path/to/yuzu" }   (or git repo)
/// The actual Yuzu router call is stubbed below and marked clearly.
///
/// =============================================================================

module swap_router::yuzu_wrapper {
    use aptos_framework::fungible_asset::{Self, FungibleAsset};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use swap_router::storage;

    // We assume yuzu::router is available as a dependency once wired up.
    // use yuzu::router;

    // -------------------------------------------------------------------------
    // Error codes
    // -------------------------------------------------------------------------

    /// Input FA amount is zero after fee deduction.
    const E_INSUFFICIENT_INPUT: u64  = 500;
    /// Yuzu returned less than the caller-specified minimum output.
    const E_SLIPPAGE_EXCEEDED: u64   = 501;
    /// Protocol is paused.
    const E_PAUSED: u64              = 502;

    // -------------------------------------------------------------------------
    // Fee extraction helper
    // -------------------------------------------------------------------------

    /// Calculates and extracts the partner fee from a FungibleAsset (by mutable
    /// reference), depositing the fee into the treasury's primary fungible store.
    ///
    /// Uses u128 intermediate arithmetic to prevent u64 overflow when:
    ///   amount * fee_bps > u64::MAX  (possible at max fee_bps = 500 for very
    ///   large amounts).
    ///
    /// Returns the fee amount extracted (0 if the fee rounds down to zero).
    fun extract_fee_fa(
        asset: &mut FungibleAsset,
        fee_bps: u64,
        treasury: address
    ): u64 {
        let amount = fungible_asset::amount(asset);
        // Promote to u128 before multiplication to prevent overflow.
        let fee_amount = (((amount as u128) * (fee_bps as u128)) / 10_000u128) as u64;
        if (fee_amount > 0) {
            let fee_fa = fungible_asset::extract(asset, fee_amount);
            // primary_fungible_store::deposit accepts a plain address and handles
            // store creation if the treasury does not yet have one.
            primary_fungible_store::deposit(treasury, fee_fa);
        };
        fee_amount
    }

    // -------------------------------------------------------------------------
    // Public swap wrapper
    // -------------------------------------------------------------------------

    /// Public wrapper for Yuzu's FA-to-FA swap.
    ///
    /// Parameters:
    ///   user            – signer whose stats are recorded.
    ///   input_fa        – fungible asset to swap.
    ///   min_amount_out  – minimum acceptable output amount (slippage guard).
    ///                     • If charge_fee_by == "token_in":  compute this
    ///                       against (amount_in - fee), NOT the original amount.
    ///                     • If charge_fee_by == "token_out": compute this
    ///                       against the full amount_in.  The fee will be
    ///                       deducted from the output after the swap.
    ///
    /// Fee extraction order:
    ///   • "token_in"  → fee extracted from `input_fa` BEFORE calling Yuzu.
    ///   • "token_out" → fee extracted from `output_fa` AFTER Yuzu returns.
    ///
    /// Returns the net output FungibleAsset (after any "token_out" fee).
    public fun swap_exact_fa_for_fa(
        user: &signer,
        input_fa: FungibleAsset,
        min_amount_out: u64,
        // Additional Yuzu routing arguments (pool details, etc.) go here
        // once the Yuzu dependency is wired up.
    ): FungibleAsset {
        // 1. Read partner configuration — abort if protocol is paused.
        let (fee_bps, treasury, charge_fee_by, _, paused) = storage::get_partner_config();
        assert!(!paused, E_PAUSED);

        let initial_amount = fungible_asset::amount(&input_fa);
        let fee_reported   = 0u64;

        // 2. Deduct fee from input if configured to charge token_in.
        //    min_amount_out must have already been computed against the
        //    post-fee input by the caller (see module-level doc comment).
        if (charge_fee_by == std::string::utf8(b"token_in")) {
            fee_reported = extract_fee_fa(&mut input_fa, fee_bps, treasury);
            // Abort if nothing is left to swap.
            assert!(fungible_asset::amount(&input_fa) > 0, E_INSUFFICIENT_INPUT);
        };

        // 3. Forward remainder to Yuzu router.
        // -----------------------------------------------------------------------
        // STUB: This call cannot be compiled until the Yuzu dependency is added
        // to Move.toml.  Replace the line below with:
        //
        //   let output_fa = yuzu::router::swap_exact_fa_for_fa(input_fa, ...);
        //
        // -----------------------------------------------------------------------
        let output_fa = input_fa; // ← PLACEHOLDER — remove when Yuzu is wired up.

        // 4. Deduct fee from output if configured to charge token_out.
        if (charge_fee_by == std::string::utf8(b"token_out")) {
            fee_reported = extract_fee_fa(&mut output_fa, fee_bps, treasury);
        };

        // 5. Enforce slippage — abort if Yuzu returned less than the caller
        //    asked for (after any "token_out" fee has been extracted).
        assert!(fungible_asset::amount(&output_fa) >= min_amount_out, E_SLIPPAGE_EXCEEDED);

        // 6. Record swap analytics.
        let now = timestamp::now_seconds();
        storage::record_global_swap(fee_reported, now);
        storage::record_user_swap(user, initial_amount, fee_reported, now);

        output_fa
    }

    // Additional wrappers (e.g. swap_exact_coin_for_coin) follow the same pattern:
    //   read config → check paused → extract fee (token_in) → call Yuzu
    //   → extract fee (token_out) → check slippage → record analytics → return.
}
