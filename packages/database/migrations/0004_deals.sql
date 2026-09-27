CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"subtitle" text,
	"image_id" uuid,
	"mobile_image_id" uuid,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_image_id_media_files_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_mobile_image_id_media_files_id_fk" FOREIGN KEY ("mobile_image_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;