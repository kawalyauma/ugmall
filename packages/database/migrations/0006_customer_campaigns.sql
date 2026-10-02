ALTER TABLE "coupons" ADD COLUMN "customer_id" uuid;
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "coupons_customer_idx" ON "coupons" USING btree ("customer_id");
--> statement-breakpoint
CREATE TABLE "customer_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL,
  "coupon_id" uuid NOT NULL,
  "title" text NOT NULL,
  "product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_campaigns" ADD CONSTRAINT "customer_campaigns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_campaigns" ADD CONSTRAINT "customer_campaigns_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_campaigns_customer_idx" ON "customer_campaigns" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "customer_campaigns_ends_idx" ON "customer_campaigns" USING btree ("ends_at");
