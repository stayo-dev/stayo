-- Create Token Blacklist Table
CREATE TABLE IF NOT EXISTS token_blacklist (
    token TEXT PRIMARY KEY,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add explicit RLS policy for token_blacklist
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;

-- Allow read/write for service role / authenticated users (only server checks this)
CREATE POLICY "Enable all for authenticated users" ON token_blacklist
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
