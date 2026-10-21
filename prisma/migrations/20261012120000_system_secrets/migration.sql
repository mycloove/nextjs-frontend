-- Portable AI provider-key data key (DEK). One row (key = 'ai_key_dek') holds
-- the 32-byte key that provider-key envelopes are encrypted under, so a server
-- with only DATABASE_URL can decrypt them. Purely additive: a new table, nothing
-- existing is altered, so this migration is safe on a live database.

-- CreateTable
CREATE TABLE "system_secrets" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "wrapped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_secrets_pkey" PRIMARY KEY ("key")
);
