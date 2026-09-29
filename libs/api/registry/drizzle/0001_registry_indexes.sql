CREATE TABLE "registry_indexes" (
	"registry" text NOT NULL,
	"key" text NOT NULL,
	"body" jsonb NOT NULL,
	"etag" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registry_indexes_pkey" PRIMARY KEY("registry","key")
);
