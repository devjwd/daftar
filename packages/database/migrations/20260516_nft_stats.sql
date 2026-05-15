-- TABLE: nft_collection_stats
CREATE TABLE IF NOT EXISTS public.nft_collection_stats (
  collection_id    text         PRIMARY KEY,
  name             text,
  floor_price      numeric      NOT NULL DEFAULT 0, -- in MOVE
  top_bid          numeric      NOT NULL DEFAULT 0, -- in MOVE
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_nft_collection_stats_updated_at ON public.nft_collection_stats;
CREATE TRIGGER trg_nft_collection_stats_updated_at BEFORE UPDATE ON public.nft_collection_stats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.nft_collection_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read for anon nft_stats" ON public.nft_collection_stats;
CREATE POLICY "Read for anon nft_stats" ON public.nft_collection_stats FOR SELECT USING (true);

-- Permissions
GRANT SELECT ON public.nft_collection_stats TO anon, authenticated, service_role;
GRANT ALL ON public.nft_collection_stats TO authenticated, service_role;
