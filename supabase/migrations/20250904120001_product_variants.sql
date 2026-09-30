CREATE TABLE "menu_item_variants" (
  "id" serial PRIMARY KEY NOT NULL,
  "menuItemId" integer NOT NULL,
  "name" varchar(120) NOT NULL,
  "quantity" numeric(12,3),
  "unit" varchar(24),
  "price" numeric(10,2) NOT NULL,
  "sku" varchar(80),
  "available" boolean DEFAULT true NOT NULL,
  "isDefault" boolean DEFAULT false NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "menu_item_variants" ADD CONSTRAINT "menu_item_variants_menuItemId_menu_items_id_fk" FOREIGN KEY ("menuItemId") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "menu_item_variant_name_unique" ON "menu_item_variants" USING btree ("menuItemId","name");
CREATE UNIQUE INDEX "menu_item_variants_sku_unique" ON "menu_item_variants" USING btree ("sku");
CREATE INDEX "menu_item_variants_menu_idx" ON "menu_item_variants" USING btree ("menuItemId");
CREATE INDEX "menu_item_variants_available_idx" ON "menu_item_variants" USING btree ("available");
ALTER TABLE "order_items" ADD COLUMN "variantId" integer;
ALTER TABLE "order_items" ADD COLUMN "variantName" varchar(120);
ALTER TABLE "order_items" ADD COLUMN "variantQuantity" numeric(12,3);
ALTER TABLE "order_items" ADD COLUMN "variantUnit" varchar(24);
ALTER TABLE "order_items" ADD COLUMN "sku" varchar(80);
ALTER TABLE "order_items" ADD COLUMN "unitPrice" numeric(10,2);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_menu_item_variants_id_fk" FOREIGN KEY ("variantId") REFERENCES "public"."menu_item_variants"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variantId");
CREATE INDEX "order_items_menu_variant_idx" ON "order_items" USING btree ("menuItemId","variantId");
CREATE TABLE "menu_variant_ingredients" (
  "id" serial PRIMARY KEY NOT NULL,
  "variantId" integer NOT NULL,
  "inventoryItemId" integer NOT NULL,
  "quantityPerSale" numeric(12,3) NOT NULL
);
ALTER TABLE "menu_variant_ingredients" ADD CONSTRAINT "menu_variant_ingredients_variantId_menu_item_variants_id_fk" FOREIGN KEY ("variantId") REFERENCES "public"."menu_item_variants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "menu_variant_ingredients" ADD CONSTRAINT "menu_variant_ingredients_inventoryItemId_inventory_items_id_fk" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "menu_variant_ingredient_unique" ON "menu_variant_ingredients" USING btree ("variantId","inventoryItemId");
CREATE INDEX "menu_variant_ingredients_variant_idx" ON "menu_variant_ingredients" USING btree ("variantId");
ALTER TABLE "recipes" ADD COLUMN "variantId" integer;
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_variantId_menu_item_variants_id_fk" FOREIGN KEY ("variantId") REFERENCES "public"."menu_item_variants"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "recipes_variant_idx" ON "recipes" USING btree ("variantId");
CREATE TABLE "outlet_variant_availability" (
  "id" serial PRIMARY KEY NOT NULL,
  "outletId" integer NOT NULL,
  "variantId" integer NOT NULL,
  "available" boolean DEFAULT true NOT NULL,
  "priceOverride" numeric(10,2),
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "outlet_variant_availability" ADD CONSTRAINT "outlet_variant_availability_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outlet_variant_availability" ADD CONSTRAINT "outlet_variant_availability_variantId_menu_item_variants_id_fk" FOREIGN KEY ("variantId") REFERENCES "public"."menu_item_variants"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "outlet_variant_availability_unique" ON "outlet_variant_availability" USING btree ("outletId","variantId");
CREATE INDEX "outlet_variant_availability_outlet_idx" ON "outlet_variant_availability" USING btree ("outletId");
CREATE INDEX "outlet_variant_availability_variant_idx" ON "outlet_variant_availability" USING btree ("variantId");
