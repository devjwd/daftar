-- Create discord_guild_configs table
CREATE TABLE public.discord_guild_configs (
    guild_id TEXT PRIMARY KEY,
    guild_name TEXT NOT NULL,
    verified_role_id TEXT,
    pro_role_id TEXT,
    modlogs_channel_id TEXT,
    support_category_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.discord_guild_configs ENABLE ROW LEVEL SECURITY;

-- Allow read access to all (backend uses service role anyway)
CREATE POLICY "Allow public read access to discord_guild_configs" ON public.discord_guild_configs FOR SELECT USING (true);
