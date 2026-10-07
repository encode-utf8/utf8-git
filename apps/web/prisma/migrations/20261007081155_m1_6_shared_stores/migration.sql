-- CreateTable
CREATE TABLE "shared_cache_entries" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "stored_at" BIGINT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_cache_entries_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rate_limit_states" (
    "user_id" TEXT NOT NULL,
    "limit_value" INTEGER,
    "remaining" INTEGER NOT NULL,
    "reset_at" TIMESTAMP(3),
    "cost" INTEGER,
    "source" TEXT NOT NULL,
    "recorded_at" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_states_pkey" PRIMARY KEY ("user_id")
);
