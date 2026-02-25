export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      cloud_sources: {
        Row: {
          cloud_etag: string | null
          cloud_file_id: string
          cloud_modified_at: number | null
          cloud_revision: string | null
          created_at: string | null
          document_file_id: string
          filename_hash: string
          id: string
          last_processed_at: string | null
          last_synced_at: string | null
          next_allowed_process_at: string | null
          process_count: number | null
          source_type: string
          sync_status: string | null
        }
        Insert: {
          cloud_etag?: string | null
          cloud_file_id: string
          cloud_modified_at?: number | null
          cloud_revision?: string | null
          created_at?: string | null
          document_file_id: string
          filename_hash: string
          id?: string
          last_processed_at?: string | null
          last_synced_at?: string | null
          next_allowed_process_at?: string | null
          process_count?: number | null
          source_type: string
          sync_status?: string | null
        }
        Update: {
          cloud_etag?: string | null
          cloud_file_id?: string
          cloud_modified_at?: number | null
          cloud_revision?: string | null
          created_at?: string | null
          document_file_id?: string
          filename_hash?: string
          id?: string
          last_processed_at?: string | null
          last_synced_at?: string | null
          next_allowed_process_at?: string | null
          process_count?: number | null
          source_type?: string
          sync_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cloud_sources_document_file_id_fkey"
            columns: ["document_file_id"]
            isOneToOne: false
            referencedRelation: "document_files"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_log: {
        Row: {
          accessed_at: string | null
          accessed_by: string
          action: string
          document_id: string
          id: string
          ip_hash: string | null
          purpose: string | null
          user_agent_hash: string | null
        }
        Insert: {
          accessed_at?: string | null
          accessed_by: string
          action: string
          document_id: string
          id?: string
          ip_hash?: string | null
          purpose?: string | null
          user_agent_hash?: string | null
        }
        Update: {
          accessed_at?: string | null
          accessed_by?: string
          action?: string
          document_id?: string
          id?: string
          ip_hash?: string | null
          purpose?: string | null
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_log_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_files: {
        Row: {
          content_hash: string
          created_at: string | null
          deleted_at: string | null
          document_id: string
          encrypted_data_key: string
          file_role: string
          file_size: number | null
          height: number | null
          id: string
          master_key_version: number
          mime_type: string
          page_count: number | null
          storage_path: string
          width: number | null
        }
        Insert: {
          content_hash: string
          created_at?: string | null
          deleted_at?: string | null
          document_id: string
          encrypted_data_key: string
          file_role?: string
          file_size?: number | null
          height?: number | null
          id?: string
          master_key_version?: number
          mime_type: string
          page_count?: number | null
          storage_path: string
          width?: number | null
        }
        Update: {
          content_hash?: string
          created_at?: string | null
          deleted_at?: string | null
          document_id?: string
          encrypted_data_key?: string
          file_role?: string
          file_size?: number | null
          height?: number | null
          id?: string
          master_key_version?: number
          mime_type?: string
          page_count?: number | null
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_files_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_private: {
        Row: {
          created_at: string | null
          document_id: string
          encrypted_extracted_data: string | null
          encrypted_metadata: string | null
          master_key_version: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          document_id: string
          encrypted_extracted_data?: string | null
          encrypted_metadata?: string | null
          master_key_version?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          document_id?: string
          encrypted_extracted_data?: string | null
          encrypted_metadata?: string | null
          master_key_version?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_private_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          document_date: string | null
          document_subtype: string | null
          document_type: string | null
          extraction_confidence: number | null
          id: string
          llm_billing: Json | null
          owner_id: string
          page_range: Json | null
          parent_document_id: string | null
          priority_score: number | null
          process_history: Json | null
          process_status: string | null
          status: string
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          document_date?: string | null
          document_subtype?: string | null
          document_type?: string | null
          extraction_confidence?: number | null
          id?: string
          llm_billing?: Json | null
          owner_id: string
          page_range?: Json | null
          parent_document_id?: string | null
          priority_score?: number | null
          process_history?: Json | null
          process_status?: string | null
          status?: string
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          document_date?: string | null
          document_subtype?: string | null
          document_type?: string | null
          extraction_confidence?: number | null
          id?: string
          llm_billing?: Json | null
          owner_id?: string
          page_range?: Json | null
          parent_document_id?: string | null
          priority_score?: number | null
          process_history?: Json | null
          process_status?: string | null
          status?: string
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      document_private_decoded: {
        Row: {
          created_at: string | null
          document_id: string | null
          extracted_data: Json | null
          master_key_version: number | null
          metadata: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          document_id?: string | null
          extracted_data?: never
          master_key_version?: number | null
          metadata?: never
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          document_id?: string | null
          extracted_data?: never
          master_key_version?: number | null
          metadata?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_private_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      check_duplicate_file: {
        Args: { p_content_hash: string; p_file_role?: string }
        Returns: string
      }
      decrypt_dek: {
        Args: { p_encrypted_dek: string; p_master_key_version: number }
        Returns: string
      }
      decrypt_jsonb: {
        Args: { p_encrypted: string; p_master_key_version: number }
        Returns: Json
      }
      encrypt_dek: {
        Args: { p_dek: string; p_master_key_version?: number }
        Returns: string
      }
      encrypt_jsonb: {
        Args: { p_data: Json; p_master_key_version?: number }
        Returns: string
      }
      get_current_master_key_version: { Args: never; Returns: number }
      get_job_priority: { Args: { p_source: string }; Returns: number }
      get_vault_secret: { Args: { p_secret_name: string }; Returns: string }
      retry_errored_documents: {
        Args: never
        Returns: {
          doc_id: string
          reason: string
          requeued: boolean
        }[]
      }
      soft_delete_document: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      worker_create_child_document: {
        Args: {
          p_owner_id: string
          p_page_range: Json
          p_parent_document_id: string
          p_type_hint?: string
        }
        Returns: string
      }
      worker_increment_llm_billing: {
        Args: {
          p_completion_tokens?: number
          p_cost?: number
          p_document_id: string
          p_pages?: number
          p_prompt_tokens?: number
        }
        Returns: boolean
      }
      worker_log_process_step: {
        Args: {
          p_document_id: string
          p_new_process_status: string
          p_step_details?: Json
        }
        Returns: boolean
      }
      worker_mark_processing_complete: {
        Args: {
          p_details?: Json
          p_document_id: string
          p_error_message?: string
          p_final_status: string
        }
        Returns: boolean
      }
      worker_update_document: {
        Args: {
          p_document_date?: string
          p_document_id: string
          p_document_subtype?: string
          p_document_type?: string
          p_extraction_confidence?: number
          p_process_status?: string
          p_status?: string
          p_valid_from?: string
          p_valid_until?: string
        }
        Returns: boolean
      }
      worker_update_document_file: {
        Args: {
          p_content_hash: string
          p_document_id: string
          p_encrypted_data_key: string
          p_file_role: string
          p_file_size: number
          p_height?: number
          p_master_key_version?: number
          p_mime_type: string
          p_page_count?: number
          p_storage_path: string
          p_width?: number
        }
        Returns: string
      }
      worker_update_document_private: {
        Args: {
          p_document_id: string
          p_encrypted_extracted_data?: string
          p_encrypted_metadata?: string
          p_master_key_version?: number
        }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

