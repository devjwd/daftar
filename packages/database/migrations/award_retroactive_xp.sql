-- =============================================================================
-- RETROACTIVE XP MIGRATION
-- Awards XP for existing Daftar swaps in the transaction_history table.
-- =============================================================================

DO $$ 
DECLARE
    r RECORD;
    v_xp_reward bigint;
    v_volume numeric;
BEGIN
    RAISE NOTICE 'Starting Retroactive XP Migration...';

    FOR r IN 
        SELECT wallet_address, amount_in_usd, amount_out_usd 
        FROM public.transaction_history 
        WHERE source = 'daftar_swap' AND status = 'success' 
    LOOP
        -- Logic: average of in/out volume
        v_volume := (COALESCE(r.amount_in_usd, 0) + COALESCE(r.amount_out_usd, 0)) / 2;
        
        -- Base XP: 1 per $5
        v_xp_reward := FLOOR(v_volume / 5);

        -- Bonuses: +50 for $500+, +5 for $100+
        IF v_volume >= 500 THEN
            v_xp_reward := v_xp_reward + 50;
        ELSIF v_volume >= 100 THEN
            v_xp_reward := v_xp_reward + 5;
        END IF;

        -- Award XP to profile
        IF v_xp_reward > 0 THEN
            INSERT INTO public.profiles (wallet_address, xp) 
            VALUES (r.wallet_address, v_xp_reward)
            ON CONFLICT (wallet_address) 
            DO UPDATE SET xp = public.profiles.xp + v_xp_reward, updated_at = now();
        END IF;
    END LOOP;

    RAISE NOTICE 'Retroactive XP Migration Complete.';
END $$;
