-- Per-tool credit controls preserve today's behavior by default. When disabled,
-- the quota boundary bypasses both pooled credits and legacy call caps.
ALTER TABLE "credit_prices"
ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
