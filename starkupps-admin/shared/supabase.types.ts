export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attendance_records: {
        Row: {
          breakEnd: string | null
          breakStart: string | null
          clockIn: string | null
          clockOut: string | null
          createdAt: string
          createdBy: number | null
          date: string
          id: number
          notes: string | null
          outletId: number | null
          shiftId: number | null
          staffId: number
          status: string
          totalHours: number | null
          updatedAt: string
        }
        Insert: {
          breakEnd?: string | null
          breakStart?: string | null
          clockIn?: string | null
          clockOut?: string | null
          createdAt?: string
          createdBy?: number | null
          date: string
          id?: number
          notes?: string | null
          outletId?: number | null
          shiftId?: number | null
          staffId: number
          status?: string
          totalHours?: number | null
          updatedAt?: string
        }
        Update: {
          breakEnd?: string | null
          breakStart?: string | null
          clockIn?: string | null
          clockOut?: string | null
          createdAt?: string
          createdBy?: number | null
          date?: string
          id?: number
          notes?: string | null
          outletId?: number | null
          shiftId?: number | null
          staffId?: number
          status?: string
          totalHours?: number | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_staff_fk"
            columns: ["staffId"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actorUserId: number | null
          after: Json | null
          before: Json | null
          createdAt: string
          entityId: number | null
          entityType: string
          id: number
          ip_address: unknown
          metadata: Json | null
          outletId: number | null
          success: boolean | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actorUserId?: number | null
          after?: Json | null
          before?: Json | null
          createdAt?: string
          entityId?: number | null
          entityType: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          outletId?: number | null
          success?: boolean | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actorUserId?: number | null
          after?: Json | null
          before?: Json | null
          createdAt?: string
          entityId?: number | null
          entityType?: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          outletId?: number | null
          success?: boolean | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_fk"
            columns: ["actorUserId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      banners: {
        Row: {
          createdAt: string
          ctaLabel: string | null
          ctaLink: string | null
          description: string | null
          id: number
          imageUrl: string | null
          position: string
          publishAt: string | null
          status: string
          title: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          ctaLabel?: string | null
          ctaLink?: string | null
          description?: string | null
          id?: number
          imageUrl?: string | null
          position?: string
          publishAt?: string | null
          status?: string
          title: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          ctaLabel?: string | null
          ctaLink?: string | null
          description?: string | null
          id?: number
          imageUrl?: string | null
          position?: string
          publishAt?: string | null
          status?: string
          title?: string
          updatedAt?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          audience: Json | null
          channels: Json | null
          couponId: number | null
          createdAt: string
          endAt: string | null
          id: number
          name: string
          offerId: number | null
          startAt: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          audience?: Json | null
          channels?: Json | null
          couponId?: number | null
          createdAt?: string
          endAt?: string | null
          id?: number
          name: string
          offerId?: number | null
          startAt?: string | null
          status?: string
          updatedAt?: string
        }
        Update: {
          audience?: Json | null
          channels?: Json | null
          couponId?: number | null
          createdAt?: string
          endAt?: string | null
          id?: number
          name?: string
          offerId?: number | null
          startAt?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: []
      }
      content_blocks: {
        Row: {
          createdAt: string
          ctaLabel: string | null
          ctaLink: string | null
          description: string | null
          id: number
          imageUrl: string | null
          key: string
          page: string
          position: number
          publishAt: string | null
          status: string
          title: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          ctaLabel?: string | null
          ctaLink?: string | null
          description?: string | null
          id?: number
          imageUrl?: string | null
          key: string
          page: string
          position?: number
          publishAt?: string | null
          status?: string
          title?: string | null
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          ctaLabel?: string | null
          ctaLink?: string | null
          description?: string | null
          id?: number
          imageUrl?: string | null
          key?: string
          page?: string
          position?: number
          publishAt?: string | null
          status?: string
          title?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          couponId: number
          createdAt: string
          customerId: number | null
          discountAmount: number
          id: number
          idempotencyKey: string | null
          orderId: number
          outletId: number | null
          status: string
          updatedAt: string
        }
        Insert: {
          couponId: number
          createdAt?: string
          customerId?: number | null
          discountAmount: number
          id?: number
          idempotencyKey?: string | null
          orderId: number
          outletId?: number | null
          status?: string
          updatedAt?: string
        }
        Update: {
          couponId?: number
          createdAt?: string
          customerId?: number | null
          discountAmount?: number
          id?: number
          idempotencyKey?: string | null
          orderId?: number
          outletId?: number | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_fk"
            columns: ["couponId"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_customer_fk"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          allowStacking: boolean
          applicableCategories: Json | null
          applicableOutlets: Json | null
          applicableProducts: Json | null
          code: string
          createdAt: string
          createdBy: number | null
          customerEligibility: string
          customerEligibilityValue: Json | null
          description: string | null
          discountType: string
          discountValue: number
          endAt: string | null
          excludeCategories: Json | null
          excludeProducts: Json | null
          id: number
          maximumDiscount: number | null
          minimumOrder: number
          name: string
          orderTypes: Json | null
          paymentMethods: Json | null
          perCustomerLimit: number | null
          priority: number
          startAt: string | null
          status: string
          timezone: string
          updatedAt: string
          usageLimit: number | null
          usedCount: number
        }
        Insert: {
          active?: boolean
          allowStacking?: boolean
          applicableCategories?: Json | null
          applicableOutlets?: Json | null
          applicableProducts?: Json | null
          code: string
          createdAt?: string
          createdBy?: number | null
          customerEligibility?: string
          customerEligibilityValue?: Json | null
          description?: string | null
          discountType?: string
          discountValue: number
          endAt?: string | null
          excludeCategories?: Json | null
          excludeProducts?: Json | null
          id?: number
          maximumDiscount?: number | null
          minimumOrder?: number
          name?: string
          orderTypes?: Json | null
          paymentMethods?: Json | null
          perCustomerLimit?: number | null
          priority?: number
          startAt?: string | null
          status?: string
          timezone?: string
          updatedAt?: string
          usageLimit?: number | null
          usedCount?: number
        }
        Update: {
          active?: boolean
          allowStacking?: boolean
          applicableCategories?: Json | null
          applicableOutlets?: Json | null
          applicableProducts?: Json | null
          code?: string
          createdAt?: string
          createdBy?: number | null
          customerEligibility?: string
          customerEligibilityValue?: Json | null
          description?: string | null
          discountType?: string
          discountValue?: number
          endAt?: string | null
          excludeCategories?: Json | null
          excludeProducts?: Json | null
          id?: number
          maximumDiscount?: number | null
          minimumOrder?: number
          name?: string
          orderTypes?: Json | null
          paymentMethods?: Json | null
          perCustomerLimit?: number | null
          priority?: number
          startAt?: string | null
          status?: string
          timezone?: string
          updatedAt?: string
          usageLimit?: number | null
          usedCount?: number
        }
        Relationships: []
      }
      csrf_tokens: {
        Row: {
          audience: string
          created_at: string | null
          expires_at: string
          id: number
          token_hash: string
          used: boolean
          user_id: number | null
        }
        Insert: {
          audience: string
          created_at?: string | null
          expires_at: string
          id?: number
          token_hash: string
          used?: boolean
          user_id?: number | null
        }
        Update: {
          audience?: string
          created_at?: string | null
          expires_at?: string
          id?: number
          token_hash?: string
          used?: boolean
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "csrf_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_feedback: {
        Row: {
          comment: string | null
          createdAt: string
          customerId: number
          id: number
          orderId: number | null
          outletId: number | null
          rating: number
        }
        Insert: {
          comment?: string | null
          createdAt?: string
          customerId: number
          id?: number
          orderId?: number | null
          outletId?: number | null
          rating: number
        }
        Update: {
          comment?: string | null
          createdAt?: string
          customerId?: number
          id?: number
          orderId?: number | null
          outletId?: number | null
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "feedback_customer_fk"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          createdAt: string
          description: string | null
          id: number
          name: string
          rules: Json | null
          slug: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          description?: string | null
          id?: number
          name: string
          rules?: Json | null
          slug: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          description?: string | null
          id?: number
          name?: string
          rules?: Json | null
          slug?: string
          updatedAt?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          createdAt: string
          email: string | null
          id: number
          name: string | null
          phone: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email?: string | null
          id?: number
          name?: string | null
          phone: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          email?: string | null
          id?: number
          name?: string | null
          phone?: string
          updatedAt?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          assignedAt: string | null
          createdAt: string
          deliveredAt: string | null
          id: number
          orderId: number
          outletId: number
          pickedAt: string | null
          riderId: number | null
          status: string
          updatedAt: string
        }
        Insert: {
          assignedAt?: string | null
          createdAt?: string
          deliveredAt?: string | null
          id?: number
          orderId: number
          outletId: number
          pickedAt?: string | null
          riderId?: number | null
          status?: string
          updatedAt?: string
        }
        Update: {
          assignedAt?: string | null
          createdAt?: string
          deliveredAt?: string | null
          id?: number
          orderId?: number
          outletId?: number
          pickedAt?: string | null
          riderId?: number | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_rider_fk"
            columns: ["riderId"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          active: boolean
          createdAt: string
          geoJson: Json | null
          id: number
          name: string
          outletId: number
          pincodes: Json | null
          radiusKm: number | null
          type: string
          updatedAt: string
        }
        Insert: {
          active?: boolean
          createdAt?: string
          geoJson?: Json | null
          id?: number
          name: string
          outletId: number
          pincodes?: Json | null
          radiusKm?: number | null
          type?: string
          updatedAt?: string
        }
        Update: {
          active?: boolean
          createdAt?: string
          geoJson?: Json | null
          id?: number
          name?: string
          outletId?: number
          pincodes?: Json | null
          radiusKm?: number | null
          type?: string
          updatedAt?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          attachmentUrl: string | null
          category: string
          createdAt: string
          createdBy: number | null
          date: string
          description: string | null
          id: number
          outletId: number | null
          updatedAt: string
          vendor: string | null
        }
        Insert: {
          amount: number
          attachmentUrl?: string | null
          category?: string
          createdAt?: string
          createdBy?: number | null
          date: string
          description?: string | null
          id?: number
          outletId?: number | null
          updatedAt?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          attachmentUrl?: string | null
          category?: string
          createdAt?: string
          createdBy?: number | null
          date?: string
          description?: string | null
          id?: number
          outletId?: number | null
          updatedAt?: string
          vendor?: string | null
        }
        Relationships: []
      }
      faqs: {
        Row: {
          active: boolean
          answer: string
          createdAt: string
          id: number
          position: number
          question: string
          updatedAt: string
        }
        Insert: {
          active?: boolean
          answer: string
          createdAt?: string
          id?: number
          position?: number
          question: string
          updatedAt?: string
        }
        Update: {
          active?: boolean
          answer?: string
          createdAt?: string
          id?: number
          position?: number
          question?: string
          updatedAt?: string
        }
        Relationships: []
      }
      instagram_posts: {
        Row: {
          caption: string | null
          createdAt: string
          id: number
          isActive: boolean
          shortcode: string
          sortOrder: number
          thumbnailUrl: string | null
          type: string
          updatedAt: string
          url: string
        }
        Insert: {
          caption?: string | null
          createdAt?: string
          id?: never
          isActive?: boolean
          shortcode: string
          sortOrder?: number
          thumbnailUrl?: string | null
          type?: string
          updatedAt?: string
          url: string
        }
        Update: {
          caption?: string | null
          createdAt?: string
          id?: never
          isActive?: boolean
          shortcode?: string
          sortOrder?: number
          thumbnailUrl?: string | null
          type?: string
          updatedAt?: string
          url?: string
        }
        Relationships: []
      }
      instagram_settings: {
        Row: {
          createdAt: string
          enabled: boolean
          eyebrow: string
          followButtonLabel: string
          heading: string
          id: number
          maxItems: number
          pauseOnHover: boolean
          profileHandle: string
          profileUrl: string
          scrollSpeed: string
          subheading: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          enabled?: boolean
          eyebrow?: string
          followButtonLabel?: string
          heading?: string
          id?: number
          maxItems?: number
          pauseOnHover?: boolean
          profileHandle?: string
          profileUrl?: string
          scrollSpeed?: string
          subheading?: string | null
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          enabled?: boolean
          eyebrow?: string
          followButtonLabel?: string
          heading?: string
          id?: number
          maxItems?: number
          pauseOnHover?: boolean
          profileHandle?: string
          profileUrl?: string
          scrollSpeed?: string
          subheading?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      inventory_alert_acknowledgements: {
        Row: {
          acknowledgedAt: string
          acknowledgedBy: number | null
          id: number
          inventoryItemId: number
          type: string
        }
        Insert: {
          acknowledgedAt?: string
          acknowledgedBy?: number | null
          id?: number
          inventoryItemId: number
          type: string
        }
        Update: {
          acknowledgedAt?: string
          acknowledgedBy?: number | null
          id?: number
          inventoryItemId?: number
          type?: string
        }
        Relationships: []
      }
      inventory_batches: {
        Row: {
          expiryDate: string | null
          id: number
          inventoryItemId: number
          lotNumber: string | null
          purchaseOrderLineId: number | null
          quantity: number
          receivedAt: string
        }
        Insert: {
          expiryDate?: string | null
          id?: number
          inventoryItemId: number
          lotNumber?: string | null
          purchaseOrderLineId?: number | null
          quantity: number
          receivedAt?: string
        }
        Update: {
          expiryDate?: string | null
          id?: number
          inventoryItemId?: number
          lotNumber?: string | null
          purchaseOrderLineId?: number | null
          quantity?: number
          receivedAt?: string
        }
        Relationships: []
      }
      inventory_categories: {
        Row: {
          createdAt: string
          description: string | null
          id: number
          name: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          description?: string | null
          id?: number
          name: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          description?: string | null
          id?: number
          name?: string
          updatedAt?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          active: boolean
          categoryId: number | null
          createdAt: string
          defaultExpiryDate: string | null
          defaultLotNumber: string | null
          description: string | null
          id: number
          lastAdjustedAt: string | null
          lastReceivedAt: string | null
          maxStockLevel: number | null
          name: string
          notes: string | null
          outletId: number | null
          quantity: number
          reorderLevel: number
          sku: string
          storageLocation: string | null
          supplierId: number | null
          unit: string
          unitCost: number
          updatedAt: string
        }
        Insert: {
          active?: boolean
          categoryId?: number | null
          createdAt?: string
          defaultExpiryDate?: string | null
          defaultLotNumber?: string | null
          description?: string | null
          id?: number
          lastAdjustedAt?: string | null
          lastReceivedAt?: string | null
          maxStockLevel?: number | null
          name: string
          notes?: string | null
          outletId?: number | null
          quantity?: number
          reorderLevel?: number
          sku: string
          storageLocation?: string | null
          supplierId?: number | null
          unit: string
          unitCost?: number
          updatedAt?: string
        }
        Update: {
          active?: boolean
          categoryId?: number | null
          createdAt?: string
          defaultExpiryDate?: string | null
          defaultLotNumber?: string | null
          description?: string | null
          id?: number
          lastAdjustedAt?: string | null
          lastReceivedAt?: string | null
          maxStockLevel?: number | null
          name?: string
          notes?: string | null
          outletId?: number | null
          quantity?: number
          reorderLevel?: number
          sku?: string
          storageLocation?: string | null
          supplierId?: number | null
          unit?: string
          unitCost?: number
          updatedAt?: string
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          batchId: number | null
          createdAt: string
          createdBy: number | null
          id: number
          inventoryItemId: number
          newQuantity: number
          notes: string | null
          previousQuantity: number
          quantityChange: number
          reason: string
          referenceId: number | null
          referenceType: string | null
          type: string
          unitCost: number | null
        }
        Insert: {
          batchId?: number | null
          createdAt?: string
          createdBy?: number | null
          id?: number
          inventoryItemId: number
          newQuantity: number
          notes?: string | null
          previousQuantity: number
          quantityChange: number
          reason: string
          referenceId?: number | null
          referenceType?: string | null
          type: string
          unitCost?: number | null
        }
        Update: {
          batchId?: number | null
          createdAt?: string
          createdBy?: number | null
          id?: number
          inventoryItemId?: number
          newQuantity?: number
          notes?: string | null
          previousQuantity?: number
          quantityChange?: number
          reason?: string
          referenceId?: number | null
          referenceType?: string | null
          type?: string
          unitCost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_item_fk"
            columns: ["inventoryItemId"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          createdAt: string
          endDate: string
          id: number
          leaveType: string
          outletId: number | null
          reason: string | null
          reviewedAt: string | null
          reviewedBy: number | null
          staffId: number
          startDate: string
          status: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          endDate: string
          id?: number
          leaveType?: string
          outletId?: number | null
          reason?: string | null
          reviewedAt?: string | null
          reviewedBy?: number | null
          staffId: number
          startDate: string
          status?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          endDate?: string
          id?: number
          leaveType?: string
          outletId?: number | null
          reason?: string | null
          reviewedAt?: string | null
          reviewedBy?: number | null
          staffId?: number
          startDate?: string
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_staff_fk"
            columns: ["staffId"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rules: {
        Row: {
          id: number
          pointsPerRupee: number
          rewardLabel: string
          rewardThreshold: number
          updatedAt: string
        }
        Insert: {
          id?: number
          pointsPerRupee?: number
          rewardLabel?: string
          rewardThreshold?: number
          updatedAt?: string
        }
        Update: {
          id?: number
          pointsPerRupee?: number
          rewardLabel?: string
          rewardThreshold?: number
          updatedAt?: string
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          createdAt: string
          customerId: number
          id: number
          orderId: number | null
          pointsChange: number
          reason: string
        }
        Insert: {
          createdAt?: string
          customerId: number
          id?: number
          orderId?: number | null
          pointsChange: number
          reason: string
        }
        Update: {
          createdAt?: string
          customerId?: number
          id?: number
          orderId?: number | null
          pointsChange?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_customer_fk"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          comingSoon: boolean
          createdAt: string
          description: string | null
          id: number
          imageUrl: string | null
          name: string
          sortOrder: number
          updatedAt: string
        }
        Insert: {
          comingSoon?: boolean
          createdAt?: string
          description?: string | null
          id?: number
          imageUrl?: string | null
          name: string
          sortOrder?: number
          updatedAt?: string
        }
        Update: {
          comingSoon?: boolean
          createdAt?: string
          description?: string | null
          id?: number
          imageUrl?: string | null
          name?: string
          sortOrder?: number
          updatedAt?: string
        }
        Relationships: []
      }
      menu_item_ingredients: {
        Row: {
          id: number
          inventoryItemId: number
          menuItemId: number
          quantityPerSale: number
        }
        Insert: {
          id?: number
          inventoryItemId: number
          menuItemId: number
          quantityPerSale: number
        }
        Update: {
          id?: number
          inventoryItemId?: number
          menuItemId?: number
          quantityPerSale?: number
        }
        Relationships: []
      }
      menu_item_modifiers: {
        Row: {
          id: number
          menuItemId: number
          modifierGroupId: number
        }
        Insert: {
          id?: number
          menuItemId: number
          modifierGroupId: number
        }
        Update: {
          id?: number
          menuItemId?: number
          modifierGroupId?: number
        }
        Relationships: []
      }
      menu_item_variants: {
        Row: {
          available: boolean
          createdAt: string
          id: number
          isDefault: boolean
          menuItemId: number
          name: string
          price: number
          quantity: number | null
          sku: string | null
          sortOrder: number
          unit: string | null
          updatedAt: string
        }
        Insert: {
          available?: boolean
          createdAt?: string
          id?: number
          isDefault?: boolean
          menuItemId: number
          name: string
          price: number
          quantity?: number | null
          sku?: string | null
          sortOrder?: number
          unit?: string | null
          updatedAt?: string
        }
        Update: {
          available?: boolean
          createdAt?: string
          id?: number
          isDefault?: boolean
          menuItemId?: number
          name?: string
          price?: number
          quantity?: number | null
          sku?: string | null
          sortOrder?: number
          unit?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_variants_menuItemId_menu_items_id_fk"
            columns: ["menuItemId"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          available: boolean
          categoryId: number
          comingSoon: boolean
          createdAt: string
          description: string | null
          id: number
          imageUrl: string | null
          name: string
          updatedAt: string
          veg: boolean
        }
        Insert: {
          available?: boolean
          categoryId: number
          comingSoon?: boolean
          createdAt?: string
          description?: string | null
          id?: number
          imageUrl?: string | null
          name: string
          updatedAt?: string
          veg?: boolean
        }
        Update: {
          available?: boolean
          categoryId?: number
          comingSoon?: boolean
          createdAt?: string
          description?: string | null
          id?: number
          imageUrl?: string | null
          name?: string
          updatedAt?: string
          veg?: boolean
        }
        Relationships: []
      }
      menu_variant_ingredients: {
        Row: {
          id: number
          inventoryItemId: number
          quantityPerSale: number
          variantId: number
        }
        Insert: {
          id?: number
          inventoryItemId: number
          quantityPerSale: number
          variantId: number
        }
        Update: {
          id?: number
          inventoryItemId?: number
          quantityPerSale?: number
          variantId?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_variant_ingredients_inventoryItemId_inventory_items_id_fk"
            columns: ["inventoryItemId"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_variant_ingredients_variantId_menu_item_variants_id_fk"
            columns: ["variantId"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          createdAt: string
          id: number
          name: string
          required: boolean
          type: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: number
          name: string
          required?: boolean
          type?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          id?: number
          name?: string
          required?: boolean
          type?: string
          updatedAt?: string
        }
        Relationships: []
      }
      modifier_options: {
        Row: {
          createdAt: string
          groupId: number
          id: number
          name: string
          priceDelta: number
        }
        Insert: {
          createdAt?: string
          groupId: number
          id?: number
          name: string
          priceDelta?: number
        }
        Update: {
          createdAt?: string
          groupId?: number
          id?: number
          name?: string
          priceDelta?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          createdAt: string
          href: string | null
          id: number
          message: string
          readAt: string | null
          recipientUserId: number | null
          title: string
          type: string
        }
        Insert: {
          createdAt?: string
          href?: string | null
          id?: number
          message: string
          readAt?: string | null
          recipientUserId?: number | null
          title: string
          type?: string
        }
        Update: {
          createdAt?: string
          href?: string | null
          id?: number
          message?: string
          readAt?: string | null
          recipientUserId?: number | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_fk"
            columns: ["recipientUserId"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean
          applicableOutlets: Json | null
          config: Json | null
          createdAt: string
          discountValue: number | null
          endAt: string | null
          id: number
          name: string
          startAt: string | null
          type: string
          updatedAt: string
        }
        Insert: {
          active?: boolean
          applicableOutlets?: Json | null
          config?: Json | null
          createdAt?: string
          discountValue?: number | null
          endAt?: string | null
          id?: number
          name: string
          startAt?: string | null
          type?: string
          updatedAt?: string
        }
        Update: {
          active?: boolean
          applicableOutlets?: Json | null
          config?: Json | null
          createdAt?: string
          discountValue?: number | null
          endAt?: string | null
          id?: number
          name?: string
          startAt?: string | null
          type?: string
          updatedAt?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: number
          itemName: string
          lineTotal: number
          menuItemId: number | null
          orderId: number
          quantity: number
          selectedModifiers: Json | null
          sku: string | null
          unitPrice: number | null
          variantId: number | null
          variantName: string | null
          variantQuantity: number | null
          variantUnit: string | null
        }
        Insert: {
          id?: number
          itemName: string
          lineTotal: number
          menuItemId?: number | null
          orderId: number
          quantity: number
          selectedModifiers?: Json | null
          sku?: string | null
          unitPrice?: number | null
          variantId?: number | null
          variantName?: string | null
          variantQuantity?: number | null
          variantUnit?: string | null
        }
        Update: {
          id?: number
          itemName?: string
          lineTotal?: number
          menuItemId?: number | null
          orderId?: number
          quantity?: number
          selectedModifiers?: Json | null
          sku?: string | null
          unitPrice?: number | null
          variantId?: number | null
          variantName?: string | null
          variantQuantity?: number | null
          variantUnit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_fk"
            columns: ["menuItemId"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variantId_menu_item_variants_id_fk"
            columns: ["variantId"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          couponCode: string | null
          couponDiscount: number
          couponId: number | null
          createdAt: string
          customerId: number | null
          id: number
          idempotencyKey: string | null
          notes: string | null
          orderNumber: number
          outletId: number | null
          paymentStatus: string
          shiftId: number | null
          source: string
          status: string
          subtotal: number
          tableNo: string | null
          terminalId: number | null
          total: number
          type: string
          updatedAt: string
        }
        Insert: {
          couponCode?: string | null
          couponDiscount?: number
          couponId?: number | null
          createdAt?: string
          customerId?: number | null
          id?: number
          idempotencyKey?: string | null
          notes?: string | null
          orderNumber: number
          outletId?: number | null
          paymentStatus?: string
          shiftId?: number | null
          source?: string
          status?: string
          subtotal: number
          tableNo?: string | null
          terminalId?: number | null
          total: number
          type: string
          updatedAt?: string
        }
        Update: {
          couponCode?: string | null
          couponDiscount?: number
          couponId?: number | null
          createdAt?: string
          customerId?: number | null
          id?: number
          idempotencyKey?: string | null
          notes?: string | null
          orderNumber?: number
          outletId?: number | null
          paymentStatus?: string
          shiftId?: number | null
          source?: string
          status?: string
          subtotal?: number
          tableNo?: string | null
          terminalId?: number | null
          total?: number
          type?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_fk"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_outlet_fk"
            columns: ["outletId"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_closures: {
        Row: {
          createdAt: string
          endAt: string
          id: number
          outletId: number
          reason: string
          startAt: string
        }
        Insert: {
          createdAt?: string
          endAt: string
          id?: number
          outletId: number
          reason: string
          startAt: string
        }
        Update: {
          createdAt?: string
          endAt?: string
          id?: number
          outletId?: number
          reason?: string
          startAt?: string
        }
        Relationships: []
      }
      outlet_hours: {
        Row: {
          closeTime: string | null
          createdAt: string
          dayOfWeek: number
          id: number
          isOpen: boolean
          openTime: string | null
          outletId: number
          updatedAt: string
        }
        Insert: {
          closeTime?: string | null
          createdAt?: string
          dayOfWeek: number
          id?: number
          isOpen?: boolean
          openTime?: string | null
          outletId: number
          updatedAt?: string
        }
        Update: {
          closeTime?: string | null
          createdAt?: string
          dayOfWeek?: number
          id?: number
          isOpen?: boolean
          openTime?: string | null
          outletId?: number
          updatedAt?: string
        }
        Relationships: []
      }
      outlet_menu_availability: {
        Row: {
          available: boolean
          createdAt: string
          id: number
          menuItemId: number
          outletId: number
          updatedAt: string
        }
        Insert: {
          available?: boolean
          createdAt?: string
          id?: number
          menuItemId: number
          outletId: number
          updatedAt?: string
        }
        Update: {
          available?: boolean
          createdAt?: string
          id?: number
          menuItemId?: number
          outletId?: number
          updatedAt?: string
        }
        Relationships: []
      }
      outlet_staff: {
        Row: {
          createdAt: string
          id: number
          outletId: number
          staffId: number
        }
        Insert: {
          createdAt?: string
          id?: number
          outletId: number
          staffId: number
        }
        Update: {
          createdAt?: string
          id?: number
          outletId?: number
          staffId?: number
        }
        Relationships: [
          {
            foreignKeyName: "outlet_staff_outlet_fk"
            columns: ["outletId"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_staff_staff_fk"
            columns: ["staffId"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_variant_availability: {
        Row: {
          available: boolean
          createdAt: string
          id: number
          outletId: number
          priceOverride: number | null
          updatedAt: string
          variantId: number
        }
        Insert: {
          available?: boolean
          createdAt?: string
          id?: number
          outletId: number
          priceOverride?: number | null
          updatedAt?: string
          variantId: number
        }
        Update: {
          available?: boolean
          createdAt?: string
          id?: number
          outletId?: number
          priceOverride?: number | null
          updatedAt?: string
          variantId?: number
        }
        Relationships: [
          {
            foreignKeyName: "outlet_variant_availability_outletId_outlets_id_fk"
            columns: ["outletId"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_variant_availability_variantId_menu_item_variants_id_fk"
            columns: ["variantId"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          address: string | null
          city: string | null
          closingTime: string
          code: string
          createdAt: string
          deliveryRadiusKm: number
          email: string | null
          id: number
          latitude: number | null
          longitude: number | null
          minimumOrder: number
          name: string
          openingTime: string
          ownerId: number | null
          phone: string | null
          pincode: string | null
          preparationTimeMinutes: number
          services: Json | null
          state: string | null
          status: string
          timezone: string
          updatedAt: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          closingTime?: string
          code: string
          createdAt?: string
          deliveryRadiusKm?: number
          email?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          minimumOrder?: number
          name: string
          openingTime?: string
          ownerId?: number | null
          phone?: string | null
          pincode?: string | null
          preparationTimeMinutes?: number
          services?: Json | null
          state?: string | null
          status?: string
          timezone?: string
          updatedAt?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          closingTime?: string
          code?: string
          createdAt?: string
          deliveryRadiusKm?: number
          email?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          minimumOrder?: number
          name?: string
          openingTime?: string
          ownerId?: number | null
          phone?: string | null
          pincode?: string | null
          preparationTimeMinutes?: number
          services?: Json | null
          state?: string | null
          status?: string
          timezone?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlets_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      password_resets: {
        Row: {
          created_at: string
          expires_at: string
          id: number
          purpose: string
          token_hash: string
          used: boolean
          user_id: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: number
          purpose?: string
          token_hash: string
          used?: boolean
          user_id: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: number
          purpose?: string
          token_hash?: string
          used?: boolean
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "password_resets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          createdAt: string
          id: number
          method: string
          orderId: number
          outletId: number | null
          provider: string | null
          providerTransactionId: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          amount: number
          createdAt?: string
          id?: number
          method?: string
          orderId: number
          outletId?: number | null
          provider?: string | null
          providerTransactionId?: string | null
          status?: string
          updatedAt?: string
        }
        Update: {
          amount?: number
          createdAt?: string
          id?: number
          method?: string
          orderId?: number
          outletId?: number | null
          provider?: string | null
          providerTransactionId?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          createdAt: string
          id: number
          outletId: number | null
          periodFrom: string | null
          periodTo: string | null
          status: string
        }
        Insert: {
          amount: number
          createdAt?: string
          id?: number
          outletId?: number | null
          periodFrom?: string | null
          periodTo?: string | null
          status?: string
        }
        Update: {
          amount?: number
          createdAt?: string
          id?: number
          outletId?: number | null
          periodFrom?: string | null
          periodTo?: string | null
          status?: string
        }
        Relationships: []
      }
      prepared_item_batches: {
        Row: {
          batchNumber: string
          createdAt: string
          expiresAt: string | null
          id: number
          outletId: number | null
          preparedBy: number | null
          preparedItemId: number
          producedAt: string
          quantity: number
          remaining: number
          status: string
        }
        Insert: {
          batchNumber: string
          createdAt?: string
          expiresAt?: string | null
          id?: number
          outletId?: number | null
          preparedBy?: number | null
          preparedItemId: number
          producedAt?: string
          quantity: number
          remaining: number
          status?: string
        }
        Update: {
          batchNumber?: string
          createdAt?: string
          expiresAt?: string | null
          id?: number
          outletId?: number | null
          preparedBy?: number | null
          preparedItemId?: number
          producedAt?: string
          quantity?: number
          remaining?: number
          status?: string
        }
        Relationships: []
      }
      prepared_items: {
        Row: {
          active: boolean
          categoryId: number | null
          createdAt: string
          description: string | null
          id: number
          lastPreparedAt: string | null
          maxStockLevel: number | null
          minQuantity: number
          name: string
          outletId: number | null
          quantity: number
          shelfLifeHours: number | null
          sku: string
          trackBatch: boolean
          trackExpiry: boolean
          unit: string
          unitCost: number
          updatedAt: string
        }
        Insert: {
          active?: boolean
          categoryId?: number | null
          createdAt?: string
          description?: string | null
          id?: number
          lastPreparedAt?: string | null
          maxStockLevel?: number | null
          minQuantity?: number
          name: string
          outletId?: number | null
          quantity?: number
          shelfLifeHours?: number | null
          sku: string
          trackBatch?: boolean
          trackExpiry?: boolean
          unit: string
          unitCost?: number
          updatedAt?: string
        }
        Update: {
          active?: boolean
          categoryId?: number | null
          createdAt?: string
          description?: string | null
          id?: number
          lastPreparedAt?: string | null
          maxStockLevel?: number | null
          minQuantity?: number
          name?: string
          outletId?: number | null
          quantity?: number
          shelfLifeHours?: number | null
          sku?: string
          trackBatch?: boolean
          trackExpiry?: boolean
          unit?: string
          unitCost?: number
          updatedAt?: string
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          id: number
          inventoryItemId: number
          orderedQuantity: number
          purchaseOrderId: number
          receivedQuantity: number
          unitCost: number
        }
        Insert: {
          id?: number
          inventoryItemId: number
          orderedQuantity: number
          purchaseOrderId: number
          receivedQuantity?: number
          unitCost: number
        }
        Update: {
          id?: number
          inventoryItemId?: number
          orderedQuantity?: number
          purchaseOrderId?: number
          receivedQuantity?: number
          unitCost?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_item_fk"
            columns: ["inventoryItemId"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_po_fk"
            columns: ["purchaseOrderId"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          createdAt: string
          createdBy: number | null
          id: number
          notes: string | null
          orderedAt: string | null
          poNumber: string
          receivedAt: string | null
          status: string
          subtotal: number
          supplierId: number
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          createdBy?: number | null
          id?: number
          notes?: string | null
          orderedAt?: string | null
          poNumber: string
          receivedAt?: string | null
          status?: string
          subtotal?: number
          supplierId: number
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          createdBy?: number | null
          id?: number
          notes?: string | null
          orderedAt?: string | null
          poNumber?: string
          receivedAt?: string | null
          status?: string
          subtotal?: number
          supplierId?: number
          updatedAt?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          reset_at: string
        }
        Insert: {
          count?: number
          key: string
          reset_at: string
        }
        Update: {
          count?: number
          key?: string
          reset_at?: string
        }
        Relationships: []
      }
      recipe_components: {
        Row: {
          componentId: number
          componentType: string
          id: number
          notes: string | null
          quantity: number
          recipeId: number
          unit: string
        }
        Insert: {
          componentId: number
          componentType: string
          id?: number
          notes?: string | null
          quantity: number
          recipeId: number
          unit: string
        }
        Update: {
          componentId?: number
          componentType?: string
          id?: number
          notes?: string | null
          quantity?: number
          recipeId?: number
          unit?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          createdAt: string
          createdBy: number | null
          estimatedCost: number
          id: number
          menuItemId: number | null
          name: string
          outletId: number | null
          status: string
          updatedAt: string
          variantId: number | null
          version: number
          yieldQuantity: number
          yieldUnit: string
        }
        Insert: {
          createdAt?: string
          createdBy?: number | null
          estimatedCost?: number
          id?: number
          menuItemId?: number | null
          name: string
          outletId?: number | null
          status?: string
          updatedAt?: string
          variantId?: number | null
          version?: number
          yieldQuantity?: number
          yieldUnit?: string
        }
        Update: {
          createdAt?: string
          createdBy?: number | null
          estimatedCost?: number
          id?: number
          menuItemId?: number | null
          name?: string
          outletId?: number | null
          status?: string
          updatedAt?: string
          variantId?: number | null
          version?: number
          yieldQuantity?: number
          yieldUnit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_variantId_menu_item_variants_id_fk"
            columns: ["variantId"]
            isOneToOne: false
            referencedRelation: "menu_item_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          createdAt: string
          createdBy: number | null
          id: number
          orderId: number
          paymentId: number | null
          providerRefundId: string | null
          reason: string
          status: string
          updatedAt: string
        }
        Insert: {
          amount: number
          createdAt?: string
          createdBy?: number | null
          id?: number
          orderId: number
          paymentId?: number | null
          providerRefundId?: string | null
          reason: string
          status?: string
          updatedAt?: string
        }
        Update: {
          amount?: number
          createdAt?: string
          createdBy?: number | null
          id?: number
          orderId?: number
          paymentId?: number | null
          providerRefundId?: string | null
          reason?: string
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_fk"
            columns: ["paymentId"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          avgDeliveryMinutes: number | null
          createdAt: string
          id: number
          name: string
          outletId: number | null
          phone: string
          rating: number
          status: string
          totalDeliveries: number
          updatedAt: string
          vehicle: string
        }
        Insert: {
          avgDeliveryMinutes?: number | null
          createdAt?: string
          id?: number
          name: string
          outletId?: number | null
          phone: string
          rating?: number
          status?: string
          totalDeliveries?: number
          updatedAt?: string
          vehicle?: string
        }
        Update: {
          avgDeliveryMinutes?: number | null
          createdAt?: string
          id?: number
          name?: string
          outletId?: number | null
          phone?: string
          rating?: number
          status?: string
          totalDeliveries?: number
          updatedAt?: string
          vehicle?: string
        }
        Relationships: []
      }
      session_limits: {
        Row: {
          active_count: number
          audience: string
          id: number
          max_allowed: number
          updated_at: string | null
          user_id: number
        }
        Insert: {
          active_count?: number
          audience: string
          id?: number
          max_allowed?: number
          updated_at?: string | null
          user_id: number
        }
        Update: {
          active_count?: number
          audience?: string
          id?: number
          max_allowed?: number
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          audience: string
          concurrent_slot: number | null
          created_at: string
          device_fingerprint: string | null
          expires_at: string
          id: number
          ip_address: unknown
          last_used_at: string
          revoked_at: string | null
          session_version_at_creation: number
          token_hash: string
          user_agent: string | null
          user_id: number
        }
        Insert: {
          audience?: string
          concurrent_slot?: number | null
          created_at?: string
          device_fingerprint?: string | null
          expires_at: string
          id?: number
          ip_address?: unknown
          last_used_at?: string
          revoked_at?: string | null
          session_version_at_creation?: number
          token_hash: string
          user_agent?: string | null
          user_id: number
        }
        Update: {
          audience?: string
          concurrent_slot?: number | null
          created_at?: string
          device_fingerprint?: string | null
          expires_at?: string
          id?: number
          ip_address?: unknown
          last_used_at?: string
          revoked_at?: string | null
          session_version_at_creation?: number
          token_hash?: string
          user_agent?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          color: string
          createdAt: string
          endTime: string
          id: number
          name: string
          outletId: number | null
          startTime: string
          updatedAt: string
        }
        Insert: {
          color?: string
          createdAt?: string
          endTime: string
          id?: number
          name: string
          outletId?: number | null
          startTime: string
          updatedAt?: string
        }
        Update: {
          color?: string
          createdAt?: string
          endTime?: string
          id?: number
          name?: string
          outletId?: number | null
          startTime?: string
          updatedAt?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          active: boolean
          createdBy: number | null
          endedAt: string | null
          id: number
          name: string
          startedAt: string
        }
        Insert: {
          active?: boolean
          createdBy?: number | null
          endedAt?: string | null
          id?: number
          name: string
          startedAt?: string
        }
        Update: {
          active?: boolean
          createdBy?: number | null
          endedAt?: string | null
          id?: number
          name?: string
          startedAt?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          active: boolean
          address: string | null
          createdAt: string
          dateOfBirth: string | null
          email: string
          emergencyContact: string | null
          employeeId: string | null
          employmentType: string
          id: number
          joiningDate: string | null
          managerId: number | null
          name: string
          phone: string | null
          primaryOutletId: number | null
          profilePhoto: string | null
          role: string
          status: string
          updatedAt: string
          userId: number | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          createdAt?: string
          dateOfBirth?: string | null
          email: string
          emergencyContact?: string | null
          employeeId?: string | null
          employmentType?: string
          id?: number
          joiningDate?: string | null
          managerId?: number | null
          name: string
          phone?: string | null
          primaryOutletId?: number | null
          profilePhoto?: string | null
          role?: string
          status?: string
          updatedAt?: string
          userId?: number | null
        }
        Update: {
          active?: boolean
          address?: string | null
          createdAt?: string
          dateOfBirth?: string | null
          email?: string
          emergencyContact?: string | null
          employeeId?: string | null
          employmentType?: string
          id?: number
          joiningDate?: string | null
          managerId?: number | null
          name?: string
          phone?: string | null
          primaryOutletId?: number | null
          profilePhoto?: string | null
          role?: string
          status?: string
          updatedAt?: string
          userId?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_primary_outlet_fk"
            columns: ["primaryOutletId"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_schedules: {
        Row: {
          createdAt: string
          createdBy: number | null
          date: string
          id: number
          outletId: number
          shiftTemplateId: number
          staffId: number
          status: string
        }
        Insert: {
          createdAt?: string
          createdBy?: number | null
          date: string
          id?: number
          outletId: number
          shiftTemplateId: number
          staffId: number
          status?: string
        }
        Update: {
          createdAt?: string
          createdBy?: number | null
          date?: string
          id?: number
          outletId?: number
          shiftTemplateId?: number
          staffId?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_staff_fk"
            columns: ["staffId"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          id: number
          inventoryItemId: number | null
          notes: string | null
          preparedItemId: number | null
          quantity: number
          transferId: number
          unitCost: number | null
        }
        Insert: {
          id?: number
          inventoryItemId?: number | null
          notes?: string | null
          preparedItemId?: number | null
          quantity: number
          transferId: number
          unitCost?: number | null
        }
        Update: {
          id?: number
          inventoryItemId?: number | null
          notes?: string | null
          preparedItemId?: number | null
          quantity?: number
          transferId?: number
          unitCost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transfer_items_transfer_fk"
            columns: ["transferId"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          approvedBy: number | null
          createdAt: string
          createdBy: number | null
          fromOutletId: number
          id: number
          notes: string | null
          status: string
          toOutletId: number
          transferNumber: string
          updatedAt: string
        }
        Insert: {
          approvedBy?: number | null
          createdAt?: string
          createdBy?: number | null
          fromOutletId: number
          id?: number
          notes?: string | null
          status?: string
          toOutletId: number
          transferNumber: string
          updatedAt?: string
        }
        Update: {
          approvedBy?: number | null
          createdAt?: string
          createdBy?: number | null
          fromOutletId?: number
          id?: number
          notes?: string | null
          status?: string
          toOutletId?: number
          transferNumber?: string
          updatedAt?: string
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          autoAcceptOrders: boolean
          closingTime: string
          deliveryFee: number
          freeDeliveryAbove: number | null
          fssaiLicense: string | null
          id: number
          openForOrders: boolean
          openingTime: string
          packingCharge: number
          paymentProvider: string | null
          storeName: string
          timezone: string
          updatedAt: string
        }
        Insert: {
          autoAcceptOrders?: boolean
          closingTime?: string
          deliveryFee?: number
          freeDeliveryAbove?: number | null
          fssaiLicense?: string | null
          id?: number
          openForOrders?: boolean
          openingTime?: string
          packingCharge?: number
          paymentProvider?: string | null
          storeName: string
          timezone?: string
          updatedAt?: string
        }
        Update: {
          autoAcceptOrders?: boolean
          closingTime?: string
          deliveryFee?: number
          freeDeliveryAbove?: number | null
          fssaiLicense?: string | null
          id?: number
          openForOrders?: boolean
          openingTime?: string
          packingCharge?: number
          paymentProvider?: string | null
          storeName?: string
          timezone?: string
          updatedAt?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          contactName: string | null
          createdAt: string
          email: string | null
          id: number
          name: string
          notes: string | null
          phone: string | null
          suppliedCategories: Json | null
          updatedAt: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          contactName?: string | null
          createdAt?: string
          email?: string | null
          id?: number
          name: string
          notes?: string | null
          phone?: string | null
          suppliedCategories?: Json | null
          updatedAt?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          contactName?: string | null
          createdAt?: string
          email?: string | null
          id?: number
          name?: string
          notes?: string | null
          phone?: string | null
          suppliedCategories?: Json | null
          updatedAt?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          authorId: number | null
          authorType: string
          createdAt: string
          id: number
          internal: boolean
          message: string
          ticketId: number
        }
        Insert: {
          authorId?: number | null
          authorType?: string
          createdAt?: string
          id?: number
          internal?: boolean
          message: string
          ticketId: number
        }
        Update: {
          authorId?: number | null
          authorType?: string
          createdAt?: string
          id?: number
          internal?: boolean
          message?: string
          ticketId?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_fk"
            columns: ["ticketId"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assignedStaffId: number | null
          category: string
          createdAt: string
          customerId: number | null
          id: number
          orderId: number | null
          outletId: number | null
          priority: string
          status: string
          subject: string
          ticketNumber: string
          updatedAt: string
        }
        Insert: {
          assignedStaffId?: number | null
          category?: string
          createdAt?: string
          customerId?: number | null
          id?: number
          orderId?: number | null
          outletId?: number | null
          priority?: string
          status?: string
          subject: string
          ticketNumber: string
          updatedAt?: string
        }
        Update: {
          assignedStaffId?: number | null
          category?: string
          createdAt?: string
          customerId?: number | null
          id?: number
          orderId?: number | null
          outletId?: number | null
          priority?: string
          status?: string
          subject?: string
          ticketNumber?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_customer_fk"
            columns: ["customerId"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_order_fk"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          applicability: Json | null
          createdAt: string
          enabled: boolean
          id: number
          name: string
          outletId: number | null
          rate: number
          type: string
          updatedAt: string
        }
        Insert: {
          applicability?: Json | null
          createdAt?: string
          enabled?: boolean
          id?: number
          name: string
          outletId?: number | null
          rate: number
          type?: string
          updatedAt?: string
        }
        Update: {
          applicability?: Json | null
          createdAt?: string
          enabled?: boolean
          id?: number
          name?: string
          outletId?: number | null
          rate?: number
          type?: string
          updatedAt?: string
        }
        Relationships: []
      }
      testimonials: {
        Row: {
          active: boolean
          authorName: string
          authorRole: string | null
          content: string
          createdAt: string
          id: number
          rating: number
        }
        Insert: {
          active?: boolean
          authorName: string
          authorRole?: string | null
          content: string
          createdAt?: string
          id?: number
          rating?: number
        }
        Update: {
          active?: boolean
          authorName?: string
          authorRole?: string | null
          content?: string
          createdAt?: string
          id?: number
          rating?: number
        }
        Relationships: []
      }
      users: {
        Row: {
          createdAt: string
          email: string | null
          failedLoginAttempts: number
          id: number
          lastSignedIn: string
          lockedUntil: string | null
          loginMethod: string | null
          name: string | null
          openId: string
          password_alg: string | null
          password_updated_at: string | null
          passwordHash: string | null
          passwordResetExpires: string | null
          passwordResetToken: string | null
          refresh_token_version: number | null
          role: string
          sessionVersion: number
          status: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email?: string | null
          failedLoginAttempts?: number
          id?: number
          lastSignedIn?: string
          lockedUntil?: string | null
          loginMethod?: string | null
          name?: string | null
          openId: string
          password_alg?: string | null
          password_updated_at?: string | null
          passwordHash?: string | null
          passwordResetExpires?: string | null
          passwordResetToken?: string | null
          refresh_token_version?: number | null
          role?: string
          sessionVersion?: number
          status?: string | null
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          email?: string | null
          failedLoginAttempts?: number
          id?: number
          lastSignedIn?: string
          lockedUntil?: string | null
          loginMethod?: string | null
          name?: string | null
          openId?: string
          password_alg?: string | null
          password_updated_at?: string | null
          passwordHash?: string | null
          passwordResetExpires?: string | null
          passwordResetToken?: string | null
          refresh_token_version?: number | null
          role?: string
          sessionVersion?: number
          status?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      wastage_records: {
        Row: {
          batchId: number | null
          createdAt: string
          createdBy: number | null
          estimatedCost: number
          id: number
          inventoryItemId: number | null
          notes: string | null
          outletId: number | null
          preparedBatchId: number | null
          preparedItemId: number | null
          quantity: number
          reason: string
          unit: string
        }
        Insert: {
          batchId?: number | null
          createdAt?: string
          createdBy?: number | null
          estimatedCost?: number
          id?: number
          inventoryItemId?: number | null
          notes?: string | null
          outletId?: number | null
          preparedBatchId?: number | null
          preparedItemId?: number | null
          quantity: number
          reason: string
          unit: string
        }
        Update: {
          batchId?: number | null
          createdAt?: string
          createdBy?: number | null
          estimatedCost?: number
          id?: number
          inventoryItemId?: number | null
          notes?: string | null
          outletId?: number | null
          preparedBatchId?: number | null
          preparedItemId?: number | null
          quantity?: number
          reason?: string
          unit?: string
        }
        Relationships: []
      }
      workforce_permissions: {
        Row: {
          category: string
          description: string | null
          id: number
          key: string
        }
        Insert: {
          category: string
          description?: string | null
          id?: number
          key: string
        }
        Update: {
          category?: string
          description?: string | null
          id?: number
          key?: string
        }
        Relationships: []
      }
      workforce_role_permissions: {
        Row: {
          permissionKey: string
          roleId: number
        }
        Insert: {
          permissionKey: string
          roleId: number
        }
        Update: {
          permissionKey?: string
          roleId?: number
        }
        Relationships: []
      }
      workforce_roles: {
        Row: {
          createdAt: string
          description: string | null
          id: number
          isSystem: boolean
          name: string
          slug: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          description?: string | null
          id?: number
          isSystem?: boolean
          name: string
          slug: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          description?: string | null
          id?: number
          isSystem?: boolean
          name?: string
          slug?: string
          updatedAt?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_rate_limits: { Args: never; Returns: undefined }
      is_active_staff: { Args: { uid: number }; Returns: boolean }
      is_member_of_outlet: {
        Args: { oid: number; uid: number }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
