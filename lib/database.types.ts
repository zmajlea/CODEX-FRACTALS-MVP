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
      client_encryption_keys: {
        Row: {
          client_user_id: string
          created_at: string
          dek_secret_id: string
          key_provider: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          dek_secret_id: string
          key_provider?: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          dek_secret_id?: string
          key_provider?: string
        }
        Relationships: []
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
      distributor_client_invites: {
        Row: {
          client_user_id: string
          consumed_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          status: string
          tenant_id: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          status?: string
          tenant_id: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          status?: string
          tenant_id?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_client_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      mcp_audit_log: {
        Row: {
          client_id: string | null
          created_at: string
          error: string | null
          id: string
          ip: string | null
          ok: boolean
          operator_user_id: string
          tenant_id: string
          tool: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ip?: string | null
          ok?: boolean
          operator_user_id: string
          tenant_id: string
          tool: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          ip?: string | null
          ok?: boolean
          operator_user_id?: string
          tenant_id?: string
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      oauth_auth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          operator_user_id: string
          redirect_uri: string
          scope: string
          tenant_id: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          operator_user_id: string
          redirect_uri: string
          scope?: string
          tenant_id: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          operator_user_id?: string
          redirect_uri?: string
          scope?: string
          tenant_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_auth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_auth_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string | null
          client_secret_hash: string | null
          created_at: string
          grant_types: string[]
          id: string
          redirect_uris: string[]
          token_endpoint_auth_method: string
        }
        Insert: {
          client_id: string
          client_name?: string | null
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          id?: string
          redirect_uris?: string[]
          token_endpoint_auth_method?: string
        }
        Update: {
          client_id?: string
          client_name?: string | null
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          id?: string
          redirect_uris?: string[]
          token_endpoint_auth_method?: string
        }
        Relationships: []
      }
      oauth_rate_log: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          route: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          route: string
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          route?: string
        }
        Relationships: []
      }
      oauth_refresh_tokens: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          id: string
          operator_user_id: string
          revoked_at: string | null
          rotated_from: string | null
          scope: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          operator_user_id: string
          revoked_at?: string | null
          rotated_from?: string | null
          scope: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          operator_user_id?: string
          revoked_at?: string | null
          rotated_from?: string | null
          scope?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_refresh_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_refresh_tokens_rotated_from_fkey"
            columns: ["rotated_from"]
            isOneToOne: false
            referencedRelation: "oauth_refresh_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_refresh_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          operator_user_id: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          operator_user_id: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          operator_user_id?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_api_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_modules: {
        Row: {
          allowed: boolean
          branding: Json
          created_at: string
          distributor_tenant_id: string
          granted_by: string | null
          logo_url: string | null
          module_id: string
        }
        Insert: {
          allowed?: boolean
          branding?: Json
          created_at?: string
          distributor_tenant_id: string
          granted_by?: string | null
          logo_url?: string | null
          module_id: string
        }
        Update: {
          allowed?: boolean
          branding?: Json
          created_at?: string
          distributor_tenant_id?: string
          granted_by?: string | null
          logo_url?: string | null
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
      plaid_items: {
        Row: {
          access_token_ciphertext: string
          client_user_id: string
          created_at: string
          distributor_tenant_id: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          plaid_item_id: string
          status: string
          transactions_cursor: string | null
          transactions_last_synced_at: string | null
        }
        Insert: {
          access_token_ciphertext: string
          client_user_id: string
          created_at?: string
          distributor_tenant_id?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          plaid_item_id: string
          status?: string
          transactions_cursor?: string | null
          transactions_last_synced_at?: string | null
        }
        Update: {
          access_token_ciphertext?: string
          client_user_id?: string
          created_at?: string
          distributor_tenant_id?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          plaid_item_id?: string
          status?: string
          transactions_cursor?: string | null
          transactions_last_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_distributor_tenant_id_fkey"
            columns: ["distributor_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      staff_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invite_token: string
          invited_by: string | null
          role: Database["public"]["Enums"]["ff_commercial_role"]
          status: Database["public"]["Enums"]["invite_status"]
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invite_token?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["ff_commercial_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invite_token?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["ff_commercial_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      treasury_accounts: {
        Row: {
          account_id: string
          available_balance: number | null
          client_user_id: string
          current_balance: number | null
          id: string
          iso_currency_code: string | null
          mask: string | null
          name: string | null
          plaid_item_id: string | null
          source: string
          subtype: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          available_balance?: number | null
          client_user_id: string
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          mask?: string | null
          name?: string | null
          plaid_item_id?: string | null
          source?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          available_balance?: number | null
          client_user_id?: string
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          mask?: string | null
          name?: string | null
          plaid_item_id?: string | null
          source?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_accounts_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_analytics: {
        Row: {
          client_user_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          items: Json
          shared_at: string | null
          shared_by: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          items?: Json
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          items?: Json
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_analytics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_client_documents: {
        Row: {
          analytics_id: string | null
          client_user_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          print_path: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          analytics_id?: string | null
          client_user_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          print_path?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          analytics_id?: string | null
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          print_path?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_client_documents_analytics_id_fkey"
            columns: ["analytics_id"]
            isOneToOne: false
            referencedRelation: "treasury_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_client_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_client_operator_profile: {
        Row: {
          attention_reason: string | null
          client_user_id: string
          distributor_tenant_id: string
          industry: string | null
          next_note: string | null
          updated_at: string
          watch_note: string | null
        }
        Insert: {
          attention_reason?: string | null
          client_user_id: string
          distributor_tenant_id: string
          industry?: string | null
          next_note?: string | null
          updated_at?: string
          watch_note?: string | null
        }
        Update: {
          attention_reason?: string | null
          client_user_id?: string
          distributor_tenant_id?: string
          industry?: string | null
          next_note?: string | null
          updated_at?: string
          watch_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treasury_client_operator_profile_distributor_tenant_id_fkey"
            columns: ["distributor_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_metrics: {
        Row: {
          client_user_id: string | null
          computed_at: string | null
          computed_value: Json | null
          created_at: string
          created_by: string | null
          definition: Json
          description: string
          id: string
          kind: string
          name: string
          scope: string
          source: string
          status: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          client_user_id?: string | null
          computed_at?: string | null
          computed_value?: Json | null
          created_at?: string
          created_by?: string | null
          definition: Json
          description?: string
          id?: string
          kind?: string
          name: string
          scope: string
          source?: string
          status?: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          client_user_id?: string | null
          computed_at?: string | null
          computed_value?: Json | null
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string
          id?: string
          kind?: string
          name?: string
          scope?: string
          source?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "treasury_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_recommendations: {
        Row: {
          anchor_ref: Json | null
          anchor_type: string
          category: string
          client_response: string | null
          client_seen_at: string | null
          client_user_id: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decline_note: string | null
          decline_reason: string | null
          evidence: Json
          id: string
          impact_amount: number | null
          impact_basis: string | null
          impact_unit: string | null
          kind: string
          operator_seen_at: string | null
          operator_tenant_id: string | null
          responded_at: string | null
          sealed_at: string | null
          sealed_by: string | null
          sent_at: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
          why: string
        }
        Insert: {
          anchor_ref?: Json | null
          anchor_type?: string
          category: string
          client_response?: string | null
          client_seen_at?: string | null
          client_user_id: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decline_note?: string | null
          decline_reason?: string | null
          evidence?: Json
          id?: string
          impact_amount?: number | null
          impact_basis?: string | null
          impact_unit?: string | null
          kind?: string
          operator_seen_at?: string | null
          operator_tenant_id?: string | null
          responded_at?: string | null
          sealed_at?: string | null
          sealed_by?: string | null
          sent_at?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
          why: string
        }
        Update: {
          anchor_ref?: Json | null
          anchor_type?: string
          category?: string
          client_response?: string | null
          client_seen_at?: string | null
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decline_note?: string | null
          decline_reason?: string | null
          evidence?: Json
          id?: string
          impact_amount?: number | null
          impact_basis?: string | null
          impact_unit?: string | null
          kind?: string
          operator_seen_at?: string | null
          operator_tenant_id?: string | null
          responded_at?: string | null
          sealed_at?: string | null
          sealed_by?: string | null
          sent_at?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_recommendations_operator_tenant_id_fkey"
            columns: ["operator_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_review_blocks: {
        Row: {
          body: string
          caption: string
          created_at: string
          id: string
          metric_id: string | null
          pinned_window: Json | null
          placed_snapshot: Json | null
          position: number
          proposal_state: string
          provenance: Json
          recommendation_id: string | null
          review_id: string
          role: string
          updated_at: string
        }
        Insert: {
          body?: string
          caption?: string
          created_at?: string
          id?: string
          metric_id?: string | null
          pinned_window?: Json | null
          placed_snapshot?: Json | null
          position: number
          proposal_state?: string
          provenance?: Json
          recommendation_id?: string | null
          review_id: string
          role: string
          updated_at?: string
        }
        Update: {
          body?: string
          caption?: string
          created_at?: string
          id?: string
          metric_id?: string | null
          pinned_window?: Json | null
          placed_snapshot?: Json | null
          position?: number
          proposal_state?: string
          provenance?: Json
          recommendation_id?: string | null
          review_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_review_blocks_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "treasury_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_review_blocks_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "treasury_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_review_blocks_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "treasury_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_review_versions: {
        Row: {
          change_note: string
          id: string
          published_at: string
          published_by: string | null
          review_id: string
          reviewed_as_of: string
          snapshot: Json
          superseded_at: string | null
          version: number
        }
        Insert: {
          change_note?: string
          id?: string
          published_at?: string
          published_by?: string | null
          review_id: string
          reviewed_as_of: string
          snapshot: Json
          superseded_at?: string | null
          version: number
        }
        Update: {
          change_note?: string
          id?: string
          published_at?: string
          published_by?: string | null
          review_id?: string
          reviewed_as_of?: string
          snapshot?: Json
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "treasury_review_versions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "treasury_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_reviews: {
        Row: {
          client_user_id: string
          created_at: string
          created_by: string | null
          current_version: number
          id: string
          label: string
          period_month: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          label?: string
          period_month: string
          status?: string
          tenant_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          label?: string
          period_month?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_rule_rejections: {
        Row: {
          rejected_at: string
          rejected_by: string | null
          rule_id: string
          transaction_id: string
        }
        Insert: {
          rejected_at?: string
          rejected_by?: string | null
          rule_id: string
          transaction_id: string
        }
        Update: {
          rejected_at?: string
          rejected_by?: string | null
          rule_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_rule_rejections_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "treasury_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_rule_rejections_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "treasury_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_rules: {
        Row: {
          active: boolean
          amount_max: number | null
          amount_min: number | null
          assign_label: string
          cadence: string | null
          client_user_id: string
          created_at: string
          created_by: string | null
          date_from: string | null
          date_to: string | null
          direction: string | null
          id: string
          last_applied_at: string | null
          match_merchant: string
          match_type: string
          name: string
          source: string | null
          source_transaction_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_max?: number | null
          amount_min?: number | null
          assign_label: string
          cadence?: string | null
          client_user_id: string
          created_at?: string
          created_by?: string | null
          date_from?: string | null
          date_to?: string | null
          direction?: string | null
          id?: string
          last_applied_at?: string | null
          match_merchant: string
          match_type?: string
          name: string
          source?: string | null
          source_transaction_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_max?: number | null
          amount_min?: number | null
          assign_label?: string
          cadence?: string | null
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          date_from?: string | null
          date_to?: string | null
          direction?: string | null
          id?: string
          last_applied_at?: string | null
          match_merchant?: string
          match_type?: string
          name?: string
          source?: string | null
          source_transaction_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_rules_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: false
            referencedRelation: "treasury_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_studies: {
        Row: {
          client_user_id: string
          created_at: string
          created_by: string | null
          derived_snapshot: Json
          id: string
          is_primary: boolean
          name: string
          operator_tenant_id: string | null
          params: Json
          scenarios: Json
          scope: Json
          source: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          created_by?: string | null
          derived_snapshot: Json
          id?: string
          is_primary?: boolean
          name: string
          operator_tenant_id?: string | null
          params: Json
          scenarios: Json
          scope: Json
          source?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          created_by?: string | null
          derived_snapshot?: Json
          id?: string
          is_primary?: boolean
          name?: string
          operator_tenant_id?: string | null
          params?: Json
          scenarios?: Json
          scope?: Json
          source?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_studies_operator_tenant_id_fkey"
            columns: ["operator_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_thread_attachments: {
        Row: {
          byte_size: number | null
          client_user_id: string
          content_type: string | null
          created_at: string
          filename: string
          id: string
          recommendation_id: string
          storage_path: string
        }
        Insert: {
          byte_size?: number | null
          client_user_id: string
          content_type?: string | null
          created_at?: string
          filename: string
          id?: string
          recommendation_id: string
          storage_path: string
        }
        Update: {
          byte_size?: number | null
          client_user_id?: string
          content_type?: string | null
          created_at?: string
          filename?: string
          id?: string
          recommendation_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_thread_attachments_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "treasury_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transaction_splits: {
        Row: {
          amount: number
          created_at: string
          id: string
          label: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          label: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          label?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transaction_splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "treasury_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transaction_suggestions: {
        Row: {
          client_user_id: string
          created_at: string
          rule_id: string
          suggested_label: string
          suggestion_explanation: string | null
          transaction_id: string
        }
        Insert: {
          client_user_id: string
          created_at?: string
          rule_id: string
          suggested_label: string
          suggestion_explanation?: string | null
          transaction_id: string
        }
        Update: {
          client_user_id?: string
          created_at?: string
          rule_id?: string
          suggested_label?: string
          suggestion_explanation?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transaction_suggestions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "treasury_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transaction_suggestions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "treasury_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transactions: {
        Row: {
          account_id: string
          amount: number
          authorized_date: string | null
          client_user_id: string
          created_at: string
          description: string | null
          direction: string | null
          external_id: string
          has_pending_suggestion: boolean
          id: string
          is_removed: boolean
          iso_currency_code: string | null
          label: string | null
          label_source: string | null
          labeled_at: string | null
          labeled_by: string | null
          merchant_name: string | null
          normalized_merchant: string | null
          pending: boolean
          pending_external_id: string | null
          plaid_category: string | null
          plaid_item_id: string | null
          posted_date: string | null
          raw_name: string | null
          source: string
          suggested_by_rule_id: string | null
          suggested_label: string | null
          suggestion_explanation: string | null
          suggestion_status: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          authorized_date?: string | null
          client_user_id: string
          created_at?: string
          description?: string | null
          direction?: string | null
          external_id: string
          has_pending_suggestion?: boolean
          id?: string
          is_removed?: boolean
          iso_currency_code?: string | null
          label?: string | null
          label_source?: string | null
          labeled_at?: string | null
          labeled_by?: string | null
          merchant_name?: string | null
          normalized_merchant?: string | null
          pending?: boolean
          pending_external_id?: string | null
          plaid_category?: string | null
          plaid_item_id?: string | null
          posted_date?: string | null
          raw_name?: string | null
          source?: string
          suggested_by_rule_id?: string | null
          suggested_label?: string | null
          suggestion_explanation?: string | null
          suggestion_status?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          authorized_date?: string | null
          client_user_id?: string
          created_at?: string
          description?: string | null
          direction?: string | null
          external_id?: string
          has_pending_suggestion?: boolean
          id?: string
          is_removed?: boolean
          iso_currency_code?: string | null
          label?: string | null
          label_source?: string | null
          labeled_at?: string | null
          labeled_by?: string | null
          merchant_name?: string | null
          normalized_merchant?: string | null
          pending?: boolean
          pending_external_id?: string | null
          plaid_category?: string | null
          plaid_item_id?: string | null
          posted_date?: string | null
          raw_name?: string | null
          source?: string
          suggested_by_rule_id?: string | null
          suggested_label?: string | null
          suggestion_explanation?: string | null
          suggestion_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transactions_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transactions_suggested_rule_fkey"
            columns: ["suggested_by_rule_id"]
            isOneToOne: false
            referencedRelation: "treasury_rules"
            referencedColumns: ["id"]
          },
        ]
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
          module_slug: string | null
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
          module_slug?: string | null
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
          module_slug?: string | null
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
      accept_client_invite: { Args: { p_token: string }; Returns: Json }
      accept_staff_invite: { Args: { p_token: string }; Returns: Json }
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
      erase_operator_client_record: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      ff_generate_invite_token: { Args: never; Returns: string }
      get_client_invite_preview: { Args: { p_token: string }; Returns: Json }
      get_client_login_route: { Args: never; Returns: Json }
      get_client_module_branding: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      get_ff_login_route: { Args: never; Returns: Json }
      get_staff_invite_preview: { Args: { p_token: string }; Returns: Json }
      has_active_treasury_grant: { Args: never; Returns: boolean }
      internal_vault_create_secret: {
        Args: { p_description?: string; p_name: string; p_secret: string }
        Returns: string
      }
      internal_vault_delete_secret: {
        Args: { p_id: string }
        Returns: undefined
      }
      internal_vault_read_secret: { Args: { p_id: string }; Returns: string }
      invite_distributor_staff: {
        Args: { p_email: string; p_tenant_id: string }
        Returns: Json
      }
      invite_global_admin_staff: { Args: { p_email: string }; Returns: Json }
      is_ff_client: { Args: { p_tenant_id: string }; Returns: boolean }
      is_global_admin: { Args: never; Returns: boolean }
      is_operator: { Args: { p_tenant_id: string }; Returns: boolean }
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_vault_admin: { Args: { p_vault_id: string }; Returns: boolean }
      is_vault_member: { Args: { p_vault_id: string }; Returns: boolean }
      list_distributor_staff_directory: { Args: never; Returns: Json }
      list_operator_client_invites: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      list_operator_clients: { Args: { p_tenant_id: string }; Returns: Json }
      list_operator_modules: { Args: { p_tenant_id: string }; Returns: Json }
      list_operator_treasury_clients: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      normalize_module_branding: { Args: { p_branding: Json }; Returns: Json }
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
      reactivate_operator_client_access: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      regenerate_client_invite: { Args: { p_invite_id: string }; Returns: Json }
      resolve_billing_rule_id: {
        Args: { p_distributor_tenant_id?: string; p_module_id: string }
        Returns: string
      }
      revoke_client_invite: { Args: { p_invite_id: string }; Returns: Json }
      revoke_operator_client_access: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      set_operator_module: {
        Args: { p_allowed: boolean; p_module_slug: string; p_tenant_id: string }
        Returns: {
          allowed: boolean
          branding: Json
          created_at: string
          distributor_tenant_id: string
          granted_by: string | null
          logo_url: string | null
          module_id: string
        }
        SetofOptions: {
          from: "*"
          to: "operator_modules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_operator_module_branding: {
        Args: {
          p_branding?: Json
          p_logo_url?: string
          p_module_slug: string
          p_tenant_id: string
        }
        Returns: Json
      }
      set_tenant_credit_balance: {
        Args: { p_target_balance: number; p_tenant_id: string }
        Returns: Json
      }
      set_vault_encryption_test: {
        Args: { p_encryption_test: string; p_vault_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      storage_vault_id: { Args: { object_name: string }; Returns: string }
      suspend_operator_client_access: {
        Args: { p_grant_id: string }
        Returns: Json
      }
      sync_tenant_credit_balance: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      treasury_confirm_rule_suggestions: {
        Args: {
          p_actor: string
          p_client: string
          p_rule: string
          p_transaction_ids?: string[] | null
        }
        Returns: Json
      }
      treasury_ensure_primary_cash_model: {
        Args: {
          p_account?: string | null
          p_actor: string
          p_client: string
          p_derived_snapshot?: Json
          p_name?: string
          p_params?: Json
          p_scenarios?: Json
          p_scope?: Json
          p_tenant: string
        }
        Returns: string
      }
      treasury_escape_ilike: { Args: { p_q: string }; Returns: string }
      treasury_monthly_by_category: {
        Args: {
          p_account_id?: string | null | null
          p_client: string
          p_direction?: string | null
          p_from: string
          p_to: string
        }
        Returns: Json
      }
      treasury_monthly_outflows: {
        Args: {
          p_account_id: string
          p_client: string
          p_from: string
          p_label?: string | null
          p_to: string
        }
        Returns: Json
      }
      treasury_query_summary: {
        Args: {
          p_account_id?: string | null
          p_bucket: string
          p_client: string
          p_from?: string | null
          p_to?: string | null
        }
        Returns: Json
      }
      treasury_replace_transaction_splits: {
        Args: { p_slices?: Json; p_transaction_id: string }
        Returns: undefined
      }
      treasury_rule_match_count:
        | {
            Args: {
              p_amount_max?: number | null
              p_amount_min?: number | null
              p_client: string
              p_direction?: string | null
              p_exclude_rejected_for_rule?: string | null
              p_label_null_only?: boolean
              p_match_type?: string
              p_payee_query: string
            }
            Returns: number
          }
        | {
            Args: {
              p_amount_max?: number | null
              p_amount_min?: number | null
              p_client: string
              p_date_from?: string | null
              p_date_to?: string | null
              p_direction?: string | null
              p_exclude_rejected_for_rule?: string | null
              p_label_null_only?: boolean
              p_match_type?: string
              p_payee_query: string
            }
            Returns: number
          }
      treasury_rule_match_page:
        | {
            Args: {
              p_amount_max?: number | null
              p_amount_min?: number | null
              p_client: string
              p_direction?: string | null
              p_exclude_rejected_for_rule?: string | null
              p_label_null_only?: boolean
              p_limit?: number
              p_match_type?: string
              p_offset?: number
              p_payee_query: string
            }
            Returns: {
              account_id: string
              amount: number
              authorized_date: string | null
              client_user_id: string
              created_at: string
              description: string | null
              direction: string | null
              external_id: string
              has_pending_suggestion: boolean
              id: string
              is_removed: boolean
              iso_currency_code: string | null
              label: string | null
              label_source: string | null
              labeled_at: string | null
              labeled_by: string | null
              merchant_name: string | null
              normalized_merchant: string | null
              pending: boolean
              pending_external_id: string | null
              plaid_category: string | null
              plaid_item_id: string | null
              posted_date: string | null
              raw_name: string | null
              source: string
              suggested_by_rule_id: string | null
              suggested_label: string | null
              suggestion_explanation: string | null
              suggestion_status: string | null
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "treasury_transactions"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_amount_max?: number | null
              p_amount_min?: number | null
              p_client: string
              p_date_from?: string | null
              p_date_to?: string | null
              p_direction?: string | null
              p_exclude_rejected_for_rule?: string | null
              p_label_null_only?: boolean
              p_limit?: number
              p_match_type?: string
              p_offset?: number
              p_payee_query: string
            }
            Returns: {
              account_id: string
              amount: number
              authorized_date: string | null
              client_user_id: string
              created_at: string
              description: string | null
              direction: string | null
              external_id: string
              has_pending_suggestion: boolean
              id: string
              is_removed: boolean
              iso_currency_code: string | null
              label: string | null
              label_source: string | null
              labeled_at: string | null
              labeled_by: string | null
              merchant_name: string | null
              normalized_merchant: string | null
              pending: boolean
              pending_external_id: string | null
              plaid_category: string | null
              plaid_item_id: string | null
              posted_date: string | null
              raw_name: string | null
              source: string
              suggested_by_rule_id: string | null
              suggested_label: string | null
              suggestion_explanation: string | null
              suggestion_status: string | null
              updated_at: string
            }[]
            SetofOptions: {
              from: "*"
              to: "treasury_transactions"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      treasury_rule_payee_hit: {
        Args: {
          p_description: string
          p_match_type: string
          p_merchant: string
          p_normalized: string
          p_payee: string
          p_raw: string
        }
        Returns: boolean
      }
      treasury_rule_payee_stats:
        | {
            Args: {
              p_client: string
              p_direction?: string | null
              p_match_type?: string
              p_payee_query: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount_max?: number | null
              p_amount_min?: number | null
              p_client: string
              p_date_from?: string | null
              p_date_to?: string | null
              p_direction?: string | null
              p_match_type?: string
              p_payee_query: string
            }
            Returns: Json
          }
      treasury_rule_queue_combo_confirm: {
        Args: {
          p_actor: string
          p_client: string
          p_combo: string[]
          p_rule: string
        }
        Returns: Json
      }
      treasury_rule_queue_combo_page: {
        Args: {
          p_client: string
          p_combo: string[]
          p_limit?: number
          p_offset?: number
          p_rule: string
        }
        Returns: Json
      }
      treasury_rule_queue_counts: { Args: { p_client: string }; Returns: Json }
      treasury_rule_queue_facets: {
        Args: { p_client: string; p_rule: string }
        Returns: Json
      }
      treasury_tx_chip_counts: {
        Args: {
          p_account_ids?: string[] | null
          p_amount_exact?: number | null
          p_amount_max?: number | null
          p_amount_min?: number | null
          p_client: string
          p_direction?: string | null
          p_from?: string | null
          p_q?: string | null
          p_to?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      ff_commercial_role: "global_admin" | "operator" | "client"
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
  public: {
    Enums: {
      ff_commercial_role: ["global_admin", "operator", "client"],
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

/** App alias — lib/temporal/* imports this instead of Database['public']['Enums'][...] */
export type TemporalObjectKind = Database["public"]["Enums"]["temporal_object_kind"];
