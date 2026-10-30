-- Custom account credentials (AUTH-INDEPENDENCE plan).
-- Additive only: every existing model is untouched; users rows keep working.

CREATE TYPE "auth_token_purpose" AS ENUM ('signup_verify', 'password_reset', 'change_email');

CREATE TABLE "auth_accounts" (
  "id" UUID PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  -- node:crypto scrypt, format `scrypt$N$r$p$salt$hash`. Never a plaintext or
  -- a GoTrue bcrypt copy — the password lives only with the user.
  "password_hash" TEXT NOT NULL,
  "display_name" TEXT,
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "legacy_supabase_user_id" TEXT UNIQUE,
  "user_id" UUID UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "last_login_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE TABLE "auth_tokens" (
  "id" UUID PRIMARY KEY,
  "token_hash" TEXT NOT NULL UNIQUE,
  "purpose" "auth_token_purpose" NOT NULL,
  "account_id" UUID NOT NULL REFERENCES "auth_accounts"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "auth_tokens_account_id_purpose_idx" ON "auth_tokens"("account_id", "purpose");

CREATE TABLE "auth_sessions" (
  "id" UUID PRIMARY KEY,
  "token_hash" TEXT NOT NULL UNIQUE,
  "account_id" UUID NOT NULL REFERENCES "auth_accounts"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_agent" TEXT
);

CREATE INDEX "auth_sessions_account_id_idx" ON "auth_sessions"("account_id");
