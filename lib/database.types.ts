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
      credit_transactions: {
        Row: {
          action: string
          amount: number
          created_at: string
          id: string
          metadata: Json
          tenant_id: string
        }
        Insert: {
          action: string
          amount: number
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id: string
        }
        Update: {
          action?: string
          amount?: number
          created_at?: string
          id?: string
          metadata?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_tenant_id_fkey"
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
          created_at: string
          id: string
          logo_url: string | null
          name: string
          subdomain: string
          updated_at: string
        }
        Insert: {
          available_credits?: number
          brand_color_hex?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          subdomain: string
          updated_at?: string
        }
        Update: {
          available_credits?: number
          brand_color_hex?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          subdomain?: string
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
      claim_demo_tenant_admin: { Args: never; Returns: boolean }
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
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_vault_admin: { Args: { p_vault_id: string }; Returns: boolean }
      is_vault_member: { Args: { p_vault_id: string }; Returns: boolean }
      provision_client_seat: {
        Args: {
          p_client_email: string
          p_client_name: string
          p_tenant_id: string
        }
        Returns: Json
      }
      storage_vault_id: { Args: { object_name: string }; Returns: string }
    }
    Enums: {
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
export type UserRole = Database["public"]["Enums"]["user_role"];
