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
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_log: Json
          id: string
          pulse_id: string
          schedule_at: string
          status: string
          updated_at: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_log?: Json
          id?: string
          pulse_id: string
          schedule_at: string
          status?: string
          updated_at?: string
          vault_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_log?: Json
          id?: string
          pulse_id?: string
          schedule_at?: string
          status?: string
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_pulse_id_fkey"
            columns: ["pulse_id"]
            isOneToOne: false
            referencedRelation: "temporal_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          credit_cost: number
          currency: string
          distributor_tenant_id: string | null
          id: string
          module_id: string | null
          payer: string
          scope: string
          stripe_price_id: string | null
          unit_price_cents: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          currency?: string
          distributor_tenant_id?: string | null
          id?: string
          module_id?: string | null
          payer: string
          scope: string
          stripe_price_id?: string | null
          unit_price_cents?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          currency?: string
          distributor_tenant_id?: string | null
          id?: string
          module_id?: string | null
          payer?: string
          scope?: string
          stripe_price_id?: string | null
          unit_price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_rules_distributor_tenant_id_fkey"
            columns: ["distributor_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_rules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      client_module_access: {
        Row: {
          billing_rule_id: string | null
          client_user_id: string
          distributor_tenant_id: string
          granted_at: string
          granted_by: string | null
          id: string
          module_id: string
          status: string
          vault_id: string | null
        }
        Insert: {
          billing_rule_id?: string | null
          client_user_id: string
          distributor_tenant_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          module_id: string
          status?: string
          vault_id?: string | null
        }
        Update: {
          billing_rule_id?: string | null
          client_user_id?: string
          distributor_tenant_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          module_id?: string
          status?: string
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_module_access_billing_rule_id_fkey"
            columns: ["billing_rule_id"]
            isOneToOne: false
            referencedRelation: "billing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_module_access_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_module_access_distributor_tenant_id_fkey"
            columns: ["distributor_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_module_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_module_access_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_module_access_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          action: string
          amount: number
          created_at: string
          created_by: string | null
          delta: number | null
          id: string
          metadata: Json
          reason: string | null
          ref_grant_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          amount: number
          created_at?: string
          created_by?: string | null
          delta?: number | null
          id?: string
          metadata?: Json
          reason?: string | null
          ref_grant_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          delta?: number | null
          id?: string
          metadata?: Json
          reason?: string | null
          ref_grant_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_ref_grant_id_fkey"
            columns: ["ref_grant_id"]
            isOneToOne: false
            referencedRelation: "client_module_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_modules: {
        Row: {
          allowed: boolean
          created_at: string
          distributor_tenant_id: string
          granted_by: string | null
          module_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          distributor_tenant_id: string
          granted_by?: string | null
          module_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          distributor_tenant_id?: string
          granted_by?: string | null
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_modules_distributor_tenant_id_fkey"
            columns: ["distributor_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_modules_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_identifier_proposals: {
        Row: {
          created_at: string
          fields_ciphertext: string
          file_id: string | null
          id: string
          status: Database["public"]["Enums"]["proposal_status"]
          updated_at: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          fields_ciphertext: string
          file_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          vault_id: string
        }
        Update: {
          created_at?: string
          fields_ciphertext?: string
          file_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["proposal_status"]
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_identifier_proposals_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_identifier_proposals_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_continuity_sections: {
        Row: {
          id: string
          payload_ciphertext: string | null
          sealed_at: string | null
          section_id: string
          updated_at: string
          vault_id: string
        }
        Insert: {
          id?: string
          payload_ciphertext?: string | null
          sealed_at?: string | null
          section_id: string
          updated_at?: string
          vault_id: string
        }
        Update: {
          id?: string
          payload_ciphertext?: string | null
          sealed_at?: string | null
          section_id?: string
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_continuity_sections_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_trusted_advisors: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          name: string
          role: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          name: string
          role: string
          vault_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          name?: string
          role?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_trusted_advisors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ff_trusted_advisors_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          byte_size: number | null
          checksum_sha256: string | null
          created_at: string
          encrypted: boolean
          file_name_ciphertext: string | null
          id: string
          mime_type: string | null
          record_id: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          vault_id: string
        }
        Insert: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          encrypted?: boolean
          file_name_ciphertext?: string | null
          id?: string
          mime_type?: string | null
          record_id: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          vault_id: string
        }
        Update: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          encrypted?: boolean
          file_name_ciphertext?: string | null
          id?: string
          mime_type?: string | null
          record_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_items: {
        Row: {
          created_at: string
          deep_link: string | null
          id: string
          item_type: string
          payload: Json
          read_at: string | null
          title_plain: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deep_link?: string | null
          id?: string
          item_type: string
          payload?: Json
          read_at?: string | null
          title_plain: string
          user_id: string
        }
        Update: {
          created_at?: string
          deep_link?: string | null
          id?: string
          item_type?: string
          payload?: Json
          read_at?: string | null
          title_plain?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_files: {
        Row: {
          created_at: string
          error_plain: string | null
          file_id: string | null
          id: string
          job_id: string
          status: Database["public"]["Enums"]["ingestion_file_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_plain?: string | null
          file_id?: string | null
          id?: string
          job_id: string
          status?: Database["public"]["Enums"]["ingestion_file_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_plain?: string | null
          file_id?: string | null
          id?: string
          job_id?: string
          status?: Database["public"]["Enums"]["ingestion_file_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_files_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          scan_mode: string
          status: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          scan_mode?: string
          status?: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at?: string
          vault_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          scan_mode?: string
          status?: Database["public"]["Enums"]["ingestion_job_status"]
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          default_billing_mode: string
          id: string
          name: string
          route_base: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_billing_mode?: string
          id?: string
          name: string
          route_base: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_billing_mode?: string
          id?: string
          name?: string
          route_base?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_tier: string | null
          created_at: string
          id: string
          payload: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_tier?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_tier?: string | null
          created_at?: string
          id?: string
          payload?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      record_activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          record_id: string | null
          vault_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          record_id?: string | null
          vault_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          record_id?: string | null
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_activity_events_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_activity_events_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      records: {
        Row: {
          archived_at: string | null
          counterparty_ciphertext: string | null
          created_at: string
          created_by: string | null
          effective_date: string | null
          encrypted: boolean
          expiry_date: string | null
          id: string
          record_type: string | null
          status: Database["public"]["Enums"]["record_status"]
          title_ciphertext: string | null
          title_plain: string | null
          updated_at: string
          vault_id: string
        }
        Insert: {
          archived_at?: string | null
          counterparty_ciphertext?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          encrypted?: boolean
          expiry_date?: string | null
          id?: string
          record_type?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          title_ciphertext?: string | null
          title_plain?: string | null
          updated_at?: string
          vault_id: string
        }
        Update: {
          archived_at?: string | null
          counterparty_ciphertext?: string | null
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          encrypted?: boolean
          expiry_date?: string | null
          id?: string
          record_type?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          title_ciphertext?: string | null
          title_plain?: string | null
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "records_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string
          id: string
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          module_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          module_id: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          module_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_subscriptions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      temporal_object_versions: {
        Row: {
          body_ciphertext: string | null
          created_at: string
          id: string
          is_canonical: boolean
          object_id: string
          sealed_at: string | null
          sealed_by: string | null
          title_ciphertext: string
          version_number: number
        }
        Insert: {
          body_ciphertext?: string | null
          created_at?: string
          id?: string
          is_canonical?: boolean
          object_id: string
          sealed_at?: string | null
          sealed_by?: string | null
          title_ciphertext: string
          version_number?: number
        }
        Update: {
          body_ciphertext?: string | null
          created_at?: string
          id?: string
          is_canonical?: boolean
          object_id?: string
          sealed_at?: string | null
          sealed_by?: string | null
          title_ciphertext?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "temporal_object_versions_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "temporal_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporal_object_versions_sealed_by_fkey"
            columns: ["sealed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      temporal_objects: {
        Row: {
          body_ciphertext: string | null
          category: string | null
          created_at: string
          created_by: string | null
          encrypted: boolean
          end_offset: number | null
          event_type: string | null
          explanation_ciphertext: string | null
          file_id: string | null
          id: string
          kind: Database["public"]["Enums"]["temporal_object_kind"]
          lens_id: string | null
          page_number: number | null
          parsed_date: string | null
          qualifier_ciphertext: string | null
          record_id: string
          start_offset: number | null
          title_ciphertext: string
          updated_at: string
          vault_id: string
          verified_at: string | null
          verified_by: string | null
          zone_index: number | null
        }
        Insert: {
          body_ciphertext?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          encrypted?: boolean
          end_offset?: number | null
          event_type?: string | null
          explanation_ciphertext?: string | null
          file_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["temporal_object_kind"]
          lens_id?: string | null
          page_number?: number | null
          parsed_date?: string | null
          qualifier_ciphertext?: string | null
          record_id: string
          start_offset?: number | null
          title_ciphertext: string
          updated_at?: string
          vault_id: string
          verified_at?: string | null
          verified_by?: string | null
          zone_index?: number | null
        }
        Update: {
          body_ciphertext?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          encrypted?: boolean
          end_offset?: number | null
          event_type?: string | null
          explanation_ciphertext?: string | null
          file_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["temporal_object_kind"]
          lens_id?: string | null
          page_number?: number | null
          parsed_date?: string | null
          qualifier_ciphertext?: string | null
          record_id?: string
          start_offset?: number | null
          title_ciphertext?: string
          updated_at?: string
          vault_id?: string
          verified_at?: string | null
          verified_by?: string | null
          zone_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "temporal_objects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporal_objects_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporal_objects_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporal_objects_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporal_objects_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          available_credits: number
          brand_color_hex: string | null
          branding: Json
          created_at: string
          credit_balance: number
          domain_slug: string
          id: string
          is_house: boolean
          kind: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          available_credits?: number
          brand_color_hex?: string | null
          branding?: Json
          created_at?: string
          credit_balance?: number
          domain_slug: string
          id?: string
          is_house?: boolean
          kind?: string
          logo_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          available_credits?: number
          brand_color_hex?: string | null
          branding?: Json
          created_at?: string
          credit_balance?: number
          domain_slug?: string
          id?: string
          is_house?: boolean
          kind?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_audit_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          user_id: string
          vault_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          user_id: string
          vault_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          user_id?: string
          vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_audit_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_audit_events_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["ff_commercial_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["ff_commercial_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["ff_commercial_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          enabled: boolean
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          enabled?: boolean
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          enabled?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invite_token: string | null
          invited_by: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invite_status"]
          tenant_id: string | null
          updated_at: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invite_token?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string | null
          updated_at?: string
          vault_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invite_token?: string | null
          invited_by?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string | null
          updated_at?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_invites_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_members: {
        Row: {
          created_at: string
          id: string
          invited_email: string | null
          joined_at: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
          vault_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
          vault_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
          vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_members_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      vaults: {
        Row: {
          created_at: string
          created_by: string | null
          encryption_test: string | null
          encryption_test_updated_at: string | null
          ff_status: Database["public"]["Enums"]["ff_status"]
          id: string
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          encryption_test?: string | null
          encryption_test_updated_at?: string | null
          ff_status?: Database["public"]["Enums"]["ff_status"]
          id?: string
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          encryption_test?: string | null
          encryption_test_updated_at?: string | null
          ff_status?: Database["public"]["Enums"]["ff_status"]
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vaults_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaults_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_distributor: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["ff_commercial_role"]
          tenant_id: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_roles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_bootstrap_global_admin: { Args: never; Returns: boolean }
      claim_demo_tenant_admin: { Args: never; Returns: boolean }
      create_distributor_tenant: {
        Args: {
          p_brand_color_hex?: string
          p_domain_slug: string
          p_initial_credits?: number
          p_logo_url?: string
          p_name: string
        }
        Returns: {
          available_credits: number
          brand_color_hex: string | null
          branding: Json
          created_at: string
          credit_balance: number
          domain_slug: string
          id: string
          is_house: boolean
          kind: string
          logo_url: string | null
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_vault: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          created_by: string | null
          encryption_test: string | null
          encryption_test_updated_at: string | null
          ff_status: Database["public"]["Enums"]["ff_status"]
          id: string
          name: string
          tenant_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "vaults"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      elevate_codexone_global_admin: { Args: never; Returns: boolean }
      ff_generate_invite_token: { Args: never; Returns: string }
      get_ff_login_route: { Args: never; Returns: Json }
      is_distributor: { Args: { p_tenant_id: string }; Returns: boolean }
      is_ff_client: { Args: { p_tenant_id: string }; Returns: boolean }
      is_global_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_vault_admin: { Args: { p_vault_id: string }; Returns: boolean }
      is_vault_member: { Args: { p_vault_id: string }; Returns: boolean }
      provision_client_seat:
        | {
            Args: {
              p_client_email: string
              p_client_name: string
              p_tenant_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_email: string
              p_client_name: string
              p_module_slug?: string
              p_tenant_id: string
            }
            Returns: Json
          }
      resolve_billing_rule_id: {
        Args: { p_distributor_tenant_id?: string; p_module_id: string }
        Returns: string
      }
      storage_vault_id: { Args: { object_name: string }; Returns: string }
      sync_tenant_credit_balance: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
    }
    Enums: {
      ff_commercial_role: "global_admin" | "distributor" | "client"
      ff_status: "unstarted" | "in_progress" | "sealed"
      ingestion_file_status:
        | "uploading"
        | "queued"
        | "scanning"
        | "complete"
        | "failed"
        | "cancelled"
      ingestion_job_status:
        | "uploading"
        | "queued"
        | "scanning"
        | "complete"
        | "partial"
        | "failed"
        | "cancelled"
      invite_status: "pending" | "accepted" | "rejected" | "revoked"
      proposal_status: "proposed" | "approved" | "dismissed"
      record_status: "draft" | "active" | "archived" | "sealed"
      temporal_object_kind:
        | "date"
        | "party"
        | "obligation"
        | "definition"
        | "clause"
        | "amount"
        | "other"
      user_role: "SUPER_ADMIN" | "ADMIN" | "USER" | "CLIENT"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ff_commercial_role: ["global_admin", "distributor", "client"],
      ff_status: ["unstarted", "in_progress", "sealed"],
      ingestion_file_status: [
        "uploading",
        "queued",
        "scanning",
        "complete",
        "failed",
        "cancelled",
      ],
      ingestion_job_status: [
        "uploading",
        "queued",
        "scanning",
        "complete",
        "partial",
        "failed",
        "cancelled",
      ],
      invite_status: ["pending", "accepted", "rejected", "revoked"],
      proposal_status: ["proposed", "approved", "dismissed"],
      record_status: ["draft", "active", "archived", "sealed"],
      temporal_object_kind: [
        "date",
        "party",
        "obligation",
        "definition",
        "clause",
        "amount",
        "other",
      ],
      user_role: ["SUPER_ADMIN", "ADMIN", "USER", "CLIENT"],
    },
  },
} as const

export type TemporalObjectKind = Database["public"]["Enums"]["temporal_object_kind"];
export type FfStatus = Database["public"]["Enums"]["ff_status"];
export type FfCommercialRole = Database["public"]["Enums"]["ff_commercial_role"];
export type UserRole = Database["public"]["Enums"]["user_role"];
