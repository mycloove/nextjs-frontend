-- An admin can be withdrawn without deleting the Auth account.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
