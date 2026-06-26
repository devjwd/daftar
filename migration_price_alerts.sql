-- Add price alert configurations to user_alert_configs
ALTER TABLE public.user_alert_configs 
ADD COLUMN IF NOT EXISTS alert_on_price_change BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS price_alert_threshold DECIMAL DEFAULT 5.0;

-- Create price_alerts_log table to track cooldowns
CREATE TABLE IF NOT EXISTS public.price_alerts_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    last_alert_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_alert_price DECIMAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT fk_wallet FOREIGN KEY (wallet_address) REFERENCES public.profiles(wallet_address) ON DELETE CASCADE
);

-- Enable RLS for price_alerts_log
ALTER TABLE public.price_alerts_log ENABLE ROW LEVEL SECURITY;

-- Allow read access to all (backend uses service role anyway)
CREATE POLICY "Allow public read access to price_alerts_log" ON public.price_alerts_log FOR SELECT USING (true);
