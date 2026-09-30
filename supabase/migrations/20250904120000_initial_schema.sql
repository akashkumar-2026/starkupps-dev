CREATE TABLE "attendance_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffId" integer NOT NULL,
	"outletId" integer,
	"date" date NOT NULL,
	"shiftId" integer,
	"clockIn" timestamp,
	"clockOut" timestamp,
	"breakStart" timestamp,
	"breakEnd" timestamp,
	"totalHours" numeric(5, 2),
	"status" varchar(50) DEFAULT 'present' NOT NULL,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorUserId" integer,
	"entityType" varchar(80) NOT NULL,
	"entityId" integer,
	"outletId" integer,
	"action" varchar(120) NOT NULL,
	"before" json,
	"after" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "banners" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"imageUrl" text,
	"ctaLabel" varchar(80),
	"ctaLink" varchar(500),
	"position" varchar(80) DEFAULT 'homepage_hero' NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"publishAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"audience" json,
	"offerId" integer,
	"couponId" integer,
	"channels" json,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"startAt" timestamp,
	"endAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "cash_drawers" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"terminalId" integer,
	"sessionId" integer,
	"openingCash" numeric(10, 2) NOT NULL,
	"cashSales" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cashRefunds" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cashAdjustments" numeric(10, 2) DEFAULT '0' NOT NULL,
	"expectedClosing" numeric(10, 2) NOT NULL,
	"actualClosing" numeric(10, 2),
	"variance" numeric(10, 2),
	"openedBy" integer,
	"closedBy" integer,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "content_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"page" varchar(80) NOT NULL,
	"key" varchar(120) NOT NULL,
	"title" varchar(200),
	"description" text,
	"imageUrl" text,
	"ctaLabel" varchar(80),
	"ctaLink" varchar(500),
	"position" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"publishAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coupon_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"couponId" integer NOT NULL,
	"customerId" integer,
	"orderId" integer NOT NULL,
	"outletId" integer,
	"discountAmount" numeric(10, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'applied' NOT NULL,
	"idempotencyKey" varchar(80),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) DEFAULT '' NOT NULL,
	"description" text,
	"discountType" varchar(50) DEFAULT 'percentage' NOT NULL,
	"discountValue" numeric(10, 2) NOT NULL,
	"minimumOrder" numeric(10, 2) DEFAULT '0' NOT NULL,
	"maximumDiscount" numeric(10, 2),
	"usageLimit" integer,
	"perCustomerLimit" integer,
	"usedCount" integer DEFAULT 0 NOT NULL,
	"startAt" timestamp,
	"endAt" timestamp,
	"timezone" varchar(80) DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"allowStacking" boolean DEFAULT false NOT NULL,
	"paymentMethods" json,
	"orderTypes" json,
	"customerEligibility" varchar(50) DEFAULT 'all' NOT NULL,
	"customerEligibilityValue" json,
	"applicableOutlets" json,
	"applicableProducts" json,
	"applicableCategories" json,
	"excludeProducts" json,
	"excludeCategories" json,
	"active" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "customer_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerId" integer NOT NULL,
	"outletId" integer,
	"orderId" integer,
	"rating" integer NOT NULL,
	"comment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "customer_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"description" text,
	"rules" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(32) NOT NULL,
	"name" varchar(160),
	"email" varchar(320),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"outletId" integer NOT NULL,
	"riderId" integer,
	"status" varchar(50) DEFAULT 'preparing' NOT NULL,
	"assignedAt" timestamp,
	"pickedAt" timestamp,
	"deliveredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "delivery_zones" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(50) DEFAULT 'radius' NOT NULL,
	"radiusKm" numeric(6, 2),
	"pincodes" json,
	"geoJson" json,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(50) DEFAULT 'other' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"outletId" integer,
	"vendor" varchar(160),
	"date" date NOT NULL,
	"description" text,
	"attachmentUrl" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar(500) NOT NULL,
	"answer" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "inventory_alert_acknowledgements" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "inventory_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"purchaseOrderLineId" integer,
	"lotNumber" varchar(100),
	"quantity" numeric(12, 3) NOT NULL,
	"expiryDate" date,
	"receivedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "inventory_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer,
	"categoryId" integer,
	"supplierId" integer,
	"name" varchar(160) NOT NULL,
	"sku" varchar(80) NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" varchar(24) NOT NULL,
	"reorderLevel" numeric(12, 3) DEFAULT '0' NOT NULL,
	"maxStockLevel" numeric(12, 3),
	"unitCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"storageLocation" varchar(160),
	"defaultExpiryDate" date,
	"defaultLotNumber" varchar(100),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"lastReceivedAt" timestamp,
	"lastAdjustedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "inventory_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"batchId" integer,
	"type" varchar(50) NOT NULL,
	"quantityChange" numeric(12, 3) NOT NULL,
	"previousQuantity" numeric(12, 3) NOT NULL,
	"newQuantity" numeric(12, 3) NOT NULL,
	"unitCost" numeric(12, 2),
	"reason" varchar(240) NOT NULL,
	"referenceType" varchar(80),
	"referenceId" integer,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffId" integer NOT NULL,
	"outletId" integer,
	"leaveType" varchar(50) DEFAULT 'casual' NOT NULL,
	"startDate" date NOT NULL,
	"endDate" date NOT NULL,
	"reason" text,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "loyalty_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointsPerRupee" numeric(8, 3) DEFAULT '0.1' NOT NULL,
	"rewardThreshold" integer DEFAULT 1000 NOT NULL,
	"rewardLabel" varchar(160) DEFAULT 'Reward unlocked' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "loyalty_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerId" integer NOT NULL,
	"orderId" integer,
	"pointsChange" integer NOT NULL,
	"reason" varchar(240) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "menu_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "menu_item_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"menuItemId" integer NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"quantityPerSale" numeric(12, 3) NOT NULL
);
CREATE TABLE "menu_item_modifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"menuItemId" integer NOT NULL,
	"modifierGroupId" integer NOT NULL
);
CREATE TABLE "menu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"categoryId" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"imageUrl" text,
	"veg" boolean DEFAULT true NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "modifier_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(50) DEFAULT 'single' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "modifier_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"groupId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"priceDelta" numeric(10, 2) DEFAULT '0' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipientUserId" integer,
	"type" varchar(50) DEFAULT 'system' NOT NULL,
	"title" varchar(180) NOT NULL,
	"message" text NOT NULL,
	"href" varchar(320),
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"type" varchar(50) DEFAULT 'percentage' NOT NULL,
	"discountValue" numeric(10, 2),
	"config" json,
	"applicableOutlets" json,
	"active" boolean DEFAULT true NOT NULL,
	"startAt" timestamp,
	"endAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"menuItemId" integer,
	"itemName" varchar(160) NOT NULL,
	"quantity" integer NOT NULL,
	"selectedModifiers" json,
	"lineTotal" numeric(10, 2) NOT NULL
);
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderNumber" integer NOT NULL,
	"customerId" integer,
	"outletId" integer,
	"shiftId" integer,
	"type" varchar(50) NOT NULL,
	"source" varchar(50) DEFAULT 'admin' NOT NULL,
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"paymentStatus" varchar(50) DEFAULT 'unpaid' NOT NULL,
	"couponId" integer,
	"couponCode" varchar(40),
	"couponDiscount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "outlet_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"reason" varchar(240) NOT NULL,
	"startAt" timestamp NOT NULL,
	"endAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "outlet_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"dayOfWeek" integer NOT NULL,
	"isOpen" boolean DEFAULT true NOT NULL,
	"openTime" varchar(5),
	"closeTime" varchar(5),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "outlet_menu_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"menuItemId" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"priceOverride" numeric(10, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "outlet_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"staffId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "outlets" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone" varchar(32),
	"email" varchar(320),
	"address" text,
	"city" varchar(80),
	"state" varchar(80),
	"pincode" varchar(12),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"timezone" varchar(80) DEFAULT 'Asia/Kolkata' NOT NULL,
	"openingTime" varchar(5) DEFAULT '09:00' NOT NULL,
	"closingTime" varchar(5) DEFAULT '22:00' NOT NULL,
	"deliveryRadiusKm" numeric(6, 2) DEFAULT '5' NOT NULL,
	"minimumOrder" numeric(10, 2) DEFAULT '0' NOT NULL,
	"preparationTimeMinutes" integer DEFAULT 20 NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"services" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"outletId" integer,
	"amount" numeric(10, 2) NOT NULL,
	"method" varchar(50) DEFAULT 'cash' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"provider" varchar(80),
	"providerTransactionId" varchar(160),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer,
	"amount" numeric(12, 2) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"periodFrom" date,
	"periodTo" date,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "pos_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"terminalId" integer NOT NULL,
	"staffId" integer,
	"loginAt" timestamp DEFAULT now() NOT NULL,
	"logoutAt" timestamp,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "pos_terminals" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"terminalCode" varchar(40) NOT NULL,
	"status" varchar(50) DEFAULT 'offline' NOT NULL,
	"version" varchar(40),
	"assignedStaffId" integer,
	"lastActiveAt" timestamp,
	"lastSyncAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "prepared_item_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"preparedItemId" integer NOT NULL,
	"outletId" integer,
	"batchNumber" varchar(40) NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"remaining" numeric(12, 3) NOT NULL,
	"producedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"preparedBy" integer,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "prepared_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer,
	"categoryId" integer,
	"name" varchar(160) NOT NULL,
	"sku" varchar(80) NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" varchar(24) NOT NULL,
	"minQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"maxStockLevel" numeric(12, 3),
	"shelfLifeHours" integer,
	"trackExpiry" boolean DEFAULT true NOT NULL,
	"trackBatch" boolean DEFAULT true NOT NULL,
	"unitCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"lastPreparedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "purchase_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchaseOrderId" integer NOT NULL,
	"inventoryItemId" integer NOT NULL,
	"orderedQuantity" numeric(12, 3) NOT NULL,
	"receivedQuantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unitCost" numeric(12, 2) NOT NULL
);
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"poNumber" varchar(80) NOT NULL,
	"supplierId" integer NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"orderedAt" timestamp,
	"receivedAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "recipe_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipeId" integer NOT NULL,
	"componentType" varchar(50) NOT NULL,
	"componentId" integer NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" varchar(24) NOT NULL,
	"notes" text
);
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"menuItemId" integer,
	"outletId" integer,
	"yieldQuantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"yieldUnit" varchar(24) DEFAULT 'unit' NOT NULL,
	"estimatedCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"paymentId" integer,
	"amount" numeric(10, 2) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"status" varchar(50) DEFAULT 'requested' NOT NULL,
	"providerRefundId" varchar(160),
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "riders" (
	"id" serial PRIMARY KEY NOT NULL,
	"outletId" integer,
	"name" varchar(160) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"vehicle" varchar(50) DEFAULT 'bike' NOT NULL,
	"status" varchar(50) DEFAULT 'offline' NOT NULL,
	"rating" numeric(3, 2) DEFAULT '5.00' NOT NULL,
	"avgDeliveryMinutes" integer,
	"totalDeliveries" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "shift_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"startTime" varchar(5) NOT NULL,
	"endTime" varchar(5) NOT NULL,
	"outletId" integer,
	"color" varchar(7) DEFAULT '#E2533C' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"createdBy" integer
);
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"employeeId" varchar(20),
	"name" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(32),
	"role" varchar(50) DEFAULT 'staff' NOT NULL,
	"employmentType" varchar(50) DEFAULT 'full_time' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"joiningDate" date,
	"primaryOutletId" integer,
	"profilePhoto" text,
	"dateOfBirth" date,
	"emergencyContact" varchar(32),
	"address" text,
	"managerId" integer,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "staff_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"staffId" integer NOT NULL,
	"outletId" integer NOT NULL,
	"date" date NOT NULL,
	"shiftTemplateId" integer NOT NULL,
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "stock_transfer_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transferId" integer NOT NULL,
	"inventoryItemId" integer,
	"preparedItemId" integer,
	"quantity" numeric(12, 3) NOT NULL,
	"unitCost" numeric(12, 2),
	"notes" text
);
CREATE TABLE "stock_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transferNumber" varchar(20) NOT NULL,
	"fromOutletId" integer NOT NULL,
	"toOutletId" integer NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"createdBy" integer,
	"approvedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "store_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"storeName" varchar(160) NOT NULL,
	"timezone" varchar(80) DEFAULT 'Asia/Kolkata' NOT NULL,
	"openForOrders" boolean DEFAULT false NOT NULL,
	"autoAcceptOrders" boolean DEFAULT false NOT NULL,
	"openingTime" varchar(8) DEFAULT '08:00' NOT NULL,
	"closingTime" varchar(8) DEFAULT '23:00' NOT NULL,
	"fssaiLicense" varchar(100),
	"paymentProvider" varchar(80),
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"contactName" varchar(160),
	"phone" varchar(32),
	"email" varchar(320),
	"address" text,
	"suppliedCategories" json,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticketId" integer NOT NULL,
	"authorId" integer,
	"authorType" varchar(50) DEFAULT 'staff' NOT NULL,
	"message" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticketNumber" varchar(20) NOT NULL,
	"customerId" integer,
	"orderId" integer,
	"outletId" integer,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"priority" varchar(50) DEFAULT 'normal' NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"subject" varchar(200) NOT NULL,
	"assignedStaffId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "taxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) DEFAULT 'gst' NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"applicability" json,
	"outletId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"authorName" varchar(120) NOT NULL,
	"authorRole" varchar(120),
	"content" text NOT NULL,
	"rating" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"passwordHash" varchar(512),
	"passwordResetToken" varchar(512),
	"passwordResetExpires" timestamp,
	"failedLoginAttempts" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
CREATE TABLE "wastage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventoryItemId" integer,
	"preparedItemId" integer,
	"outletId" integer,
	"batchId" integer,
	"preparedBatchId" integer,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" varchar(24) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"estimatedCost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "workforce_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"description" text,
	"category" varchar(40) NOT NULL
);
CREATE TABLE "workforce_role_permissions" (
	"roleId" integer NOT NULL,
	"permissionKey" varchar(80) NOT NULL
);
CREATE TABLE "workforce_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"description" text,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "workforce_roles_name_unique" ON "workforce_roles" USING btree ("name");