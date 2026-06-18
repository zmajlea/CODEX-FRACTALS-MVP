/**
 * Supabase database types for Fractals MVP.
 * Regenerate after schema changes: npx supabase gen types typescript --local > lib/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "USER" | "CLIENT";

export type RecordStatus = "draft" | "active" | "archived" | "sealed";

export type TemporalObjectKind =
  | "date"
  | "party"
  | "obligation"
  | "definition"
  | "clause"
  | "amount"
  | "other";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      vaults: {
        Row: {
          id: string;
          name: string;
          created_by: string | null;
          encryption_test: string | null;
          encryption_test_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          encryption_test?: string | null;
          encryption_test_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string | null;
          encryption_test?: string | null;
          encryption_test_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vaults_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      vault_members: {
        Row: {
          id: string;
          vault_id: string;
          user_id: string;
          role: UserRole;
          invited_email: string | null;
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vault_id: string;
          user_id: string;
          role?: UserRole;
          invited_email?: string | null;
          joined_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vault_id?: string;
          user_id?: string;
          role?: UserRole;
          invited_email?: string | null;
          joined_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vault_members_vault_id_fkey";
            columns: ["vault_id"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vault_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      records: {
        Row: {
          id: string;
          vault_id: string;
          created_by: string | null;
          title_ciphertext: string | null;
          title_plain: string | null;
          record_type: string | null;
          counterparty_ciphertext: string | null;
          status: RecordStatus;
          effective_date: string | null;
          expiry_date: string | null;
          encrypted: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vault_id: string;
          created_by?: string | null;
          title_ciphertext?: string | null;
          title_plain?: string | null;
          record_type?: string | null;
          counterparty_ciphertext?: string | null;
          status?: RecordStatus;
          effective_date?: string | null;
          expiry_date?: string | null;
          encrypted?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vault_id?: string;
          created_by?: string | null;
          title_ciphertext?: string | null;
          title_plain?: string | null;
          record_type?: string | null;
          counterparty_ciphertext?: string | null;
          status?: RecordStatus;
          effective_date?: string | null;
          expiry_date?: string | null;
          encrypted?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "records_vault_id_fkey";
            columns: ["vault_id"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "records_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      files: {
        Row: {
          id: string;
          vault_id: string;
          record_id: string;
          uploaded_by: string | null;
          storage_path: string;
          file_name_ciphertext: string | null;
          mime_type: string | null;
          byte_size: number | null;
          encrypted: boolean;
          checksum_sha256: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vault_id: string;
          record_id: string;
          uploaded_by?: string | null;
          storage_path: string;
          file_name_ciphertext?: string | null;
          mime_type?: string | null;
          byte_size?: number | null;
          encrypted?: boolean;
          checksum_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vault_id?: string;
          record_id?: string;
          uploaded_by?: string | null;
          storage_path?: string;
          file_name_ciphertext?: string | null;
          mime_type?: string | null;
          byte_size?: number | null;
          encrypted?: boolean;
          checksum_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "files_vault_id_fkey";
            columns: ["vault_id"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_record_id_fkey";
            columns: ["record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      temporal_objects: {
        Row: {
          id: string;
          vault_id: string;
          record_id: string;
          file_id: string | null;
          created_by: string | null;
          kind: TemporalObjectKind;
          title_ciphertext: string;
          body_ciphertext: string | null;
          explanation_ciphertext: string | null;
          category: string | null;
          parsed_date: string | null;
          event_type: string | null;
          qualifier_ciphertext: string | null;
          lens_id: string | null;
          page_number: number | null;
          start_offset: number | null;
          end_offset: number | null;
          zone_index: number | null;
          verified_at: string | null;
          verified_by: string | null;
          encrypted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vault_id: string;
          record_id: string;
          file_id?: string | null;
          created_by?: string | null;
          kind?: TemporalObjectKind;
          title_ciphertext: string;
          body_ciphertext?: string | null;
          explanation_ciphertext?: string | null;
          category?: string | null;
          parsed_date?: string | null;
          event_type?: string | null;
          qualifier_ciphertext?: string | null;
          lens_id?: string | null;
          page_number?: number | null;
          start_offset?: number | null;
          end_offset?: number | null;
          zone_index?: number | null;
          verified_at?: string | null;
          verified_by?: string | null;
          encrypted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vault_id?: string;
          record_id?: string;
          file_id?: string | null;
          created_by?: string | null;
          kind?: TemporalObjectKind;
          title_ciphertext?: string;
          body_ciphertext?: string | null;
          explanation_ciphertext?: string | null;
          category?: string | null;
          parsed_date?: string | null;
          event_type?: string | null;
          qualifier_ciphertext?: string | null;
          lens_id?: string | null;
          page_number?: number | null;
          start_offset?: number | null;
          end_offset?: number | null;
          zone_index?: number | null;
          verified_at?: string | null;
          verified_by?: string | null;
          encrypted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "temporal_objects_vault_id_fkey";
            columns: ["vault_id"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "temporal_objects_record_id_fkey";
            columns: ["record_id"];
            isOneToOne: false;
            referencedRelation: "records";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "temporal_objects_file_id_fkey";
            columns: ["file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "temporal_objects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "temporal_objects_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_vault: {
        Args: { p_name: string };
        Returns: {
          id: string;
          name: string;
          created_by: string | null;
          encryption_test: string | null;
          encryption_test_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      is_vault_member: {
        Args: { p_vault_id: string };
        Returns: boolean;
      };
      is_vault_admin: {
        Args: { p_vault_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      record_status: RecordStatus;
      temporal_object_kind: TemporalObjectKind;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type User = Tables<"users">;
export type Vault = Tables<"vaults">;
export type VaultMember = Tables<"vault_members">;
export type VaultRecord = Tables<"records">;
export type File = Tables<"files">;
export type TemporalObject = Tables<"temporal_objects">;
