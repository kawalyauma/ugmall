CREATE TABLE "product_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text,
	"format" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"options" jsonb,
	"summary" jsonb,
	"staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_source_url_idx" ON "media_files" USING btree ("source_url");--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_external_id_unique" UNIQUE("external_id");