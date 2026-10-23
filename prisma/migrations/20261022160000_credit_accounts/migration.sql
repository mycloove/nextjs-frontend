CREATE TYPE "credit_operation_state" AS ENUM ('reserved', 'settled', 'released');

CREATE TABLE "credit_policies" (
  "id" TEXT PRIMARY KEY DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "guest_allowance" INTEGER NOT NULL DEFAULT 20 CHECK ("guest_allowance" BETWEEN 0 AND 1000000),
  "member_allowance" INTEGER NOT NULL DEFAULT 100 CHECK ("member_allowance" BETWEEN 0 AND 1000000),
  "period_hours" INTEGER NOT NULL DEFAULT 24 CHECK ("period_hours" IN (24, 168)),
  "version" INTEGER NOT NULL DEFAULT 1,
  "activated_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "credit_prices" (
  "tool_id" TEXT PRIMARY KEY,
  "cost" INTEGER NOT NULL DEFAULT 1 CHECK ("cost" BETWEEN 0 AND 1000000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "credit_accounts" (
  "id" UUID PRIMARY KEY,
  "owner_key" TEXT NOT NULL UNIQUE,
  "user_id" UUID UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "allowance_override" INTEGER CHECK ("allowance_override" BETWEEN 0 AND 1000000),
  "override_expires_at" TIMESTAMPTZ(6),
  "claimed_to_id" UUID,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "credit_operations" (
  "id" UUID PRIMARY KEY,
  "account_id" UUID NOT NULL REFERENCES "credit_accounts"("id") ON DELETE CASCADE,
  "actor_key" TEXT NOT NULL,
  "tool_id" TEXT NOT NULL,
  "action_key" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "cost" INTEGER NOT NULL CHECK ("cost" BETWEEN 0 AND 1000000),
  "period_hours" INTEGER NOT NULL CHECK ("period_hours" IN (24, 168)),
  "price_version" INTEGER NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "state" "credit_operation_state" NOT NULL DEFAULT 'reserved',
  "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settled_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  CONSTRAINT "credit_operations_actor_key_action_key_operation_key_key" UNIQUE ("actor_key", "action_key", "operation_key")
);

CREATE INDEX "credit_operations_account_id_state_expires_at_idx" ON "credit_operations"("account_id", "state", "expires_at");

CREATE TABLE "credit_ledger_entries" (
  "id" UUID PRIMARY KEY,
  "account_id" UUID NOT NULL REFERENCES "credit_accounts"("id") ON DELETE CASCADE,
  "operation_id" UUID UNIQUE REFERENCES "credit_operations"("id") ON DELETE CASCADE,
  "dedupe_key" TEXT UNIQUE,
  "kind" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT,
  "actor_id" UUID,
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "credit_ledger_entries_account_id_expires_at_idx" ON "credit_ledger_entries"("account_id", "expires_at");

-- Activation is an explicit admin decision, never an implicit entitlement reset.
INSERT INTO "credit_policies" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP);
