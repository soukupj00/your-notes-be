CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text,
	"role" text NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"pruned_seq" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"account_id" text,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE "note_tags" (
	"account_id" text NOT NULL,
	"note_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"rev" integer NOT NULL,
	"seq" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "note_tags_account_id_note_id_tag_id_pk" PRIMARY KEY("account_id","note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"rev" integer NOT NULL,
	"seq" integer NOT NULL,
	"header" text,
	"description" text,
	"body" text,
	"state" text NOT NULL,
	"pinned_at" text,
	"color" text,
	"trashed_at" text,
	"remind_at" text,
	"repeat" text,
	"attachments" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "notes_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"created_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"expires_at" text NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"note_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"rev" integer NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "tags_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "tombstones" (
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"deleted_at" text NOT NULL,
	CONSTRAINT "tombstones_account_id_kind_id_pk" PRIMARY KEY("account_id","kind","id")
);
--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codes" ADD CONSTRAINT "codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blobs_account_idx" ON "blobs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "note_tags_account_seq_idx" ON "note_tags" USING btree ("account_id","seq");--> statement-breakpoint
CREATE INDEX "notes_account_seq_idx" ON "notes" USING btree ("account_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_account_note_idx" ON "shares" USING btree ("account_id","note_id");--> statement-breakpoint
CREATE INDEX "tags_account_seq_idx" ON "tags" USING btree ("account_id","seq");--> statement-breakpoint
CREATE INDEX "tombstones_account_seq_idx" ON "tombstones" USING btree ("account_id","seq");