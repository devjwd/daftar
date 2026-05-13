-- Create address_labels table for tracking discovered exchange deposit addresses
CREATE TABLE IF NOT EXISTS public.address_labels (
    address TEXT PRIMARY KEY,
    label_name TEXT NOT NULL,
    entity_id UUID REFERENCES public.tracked_entities(id) ON DELETE SET NULL,
    confidence_score FLOAT DEFAULT 1.0,
    discovery_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for querying labels by entity
CREATE INDEX IF NOT EXISTS idx_address_labels_entity_id ON public.address_labels(entity_id);

-- Enable RLS
ALTER TABLE public.address_labels ENABLE ROW LEVEL SECURITY;

-- Allow public read access to address_labels
CREATE POLICY "Public read access for address_labels"
    ON public.address_labels FOR SELECT
    USING (true);

-- Allow authenticated (service role/admin) to manage address_labels
CREATE POLICY "Admin full access for address_labels"
    ON public.address_labels FOR ALL
    USING (auth.role() = 'service_role');
