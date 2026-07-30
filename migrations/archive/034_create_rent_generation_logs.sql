CREATE TABLE IF NOT EXISTS rent_generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    rent_month DATE NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'SUCCESS',
    generated_count INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_generation_logs_month ON rent_generation_logs(rent_month DESC);
CREATE INDEX IF NOT EXISTS idx_rent_generation_logs_owner_id ON rent_generation_logs(owner_id, created_at DESC);
