export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_triage_results: {
        Row: {
          confidence: number | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          model: string
          provider: string
          report_id: string
          result: Json | null
          schema_version: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model: string
          provider: string
          report_id: string
          result?: Json | null
          schema_version: number
        }
        Update: {
          confidence?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string
          provider?: string
          report_id?: string
          result?: Json | null
          schema_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_triage_results_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_gateway_deposit_events: {
        Row: {
          amount_base_units: number
          created_at: string
          event_id: string
          event_timestamp: string
          from_address: string
          notification_id: string
          payload_version: number
          source_domain: number
          subscription_id: string
          to_address: string
          token_address: string
          transaction_hash: string
          wallet_address: string
        }
        Insert: {
          amount_base_units: number
          created_at?: string
          event_id: string
          event_timestamp: string
          from_address: string
          notification_id: string
          payload_version: number
          source_domain: number
          subscription_id: string
          to_address: string
          token_address: string
          transaction_hash: string
          wallet_address: string
        }
        Update: {
          amount_base_units?: number
          created_at?: string
          event_id?: string
          event_timestamp?: string
          from_address?: string
          notification_id?: string
          payload_version?: number
          source_domain?: number
          subscription_id?: string
          to_address?: string
          token_address?: string
          transaction_hash?: string
          wallet_address?: string
        }
        Relationships: []
      }
      circle_gateway_registrations: {
        Row: {
          created_at: string
          domains: number[]
          funding_intent_id: string
          last_error_code: string | null
          readiness_status: string
          ready_at: string | null
          required_revision: number
          subscription_id: string
          updated_at: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          domains: number[]
          funding_intent_id: string
          last_error_code?: string | null
          readiness_status?: string
          ready_at?: string | null
          required_revision: number
          subscription_id: string
          updated_at?: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          domains?: number[]
          funding_intent_id?: string
          last_error_code?: string | null
          readiness_status?: string
          ready_at?: string | null
          required_revision?: number
          subscription_id?: string
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_gateway_registrations_funding_intent_id_fkey"
            columns: ["funding_intent_id"]
            isOneToOne: true
            referencedRelation: "funding_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_gateway_registrations_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "circle_gateway_subscriptions"
            referencedColumns: ["subscription_id"]
          },
        ]
      }
      circle_gateway_subscriptions: {
        Row: {
          applied_revision: number
          created_at: string
          desired_addresses: string[]
          desired_domains: number[]
          desired_revision: number
          last_attempted_revision: number | null
          last_error_code: string | null
          last_error_retryable: boolean | null
          last_remote_addresses: string[]
          last_remote_domains: number[]
          last_remote_verified_at: string | null
          subscription_id: string
          sync_lease_expires_at: string | null
          sync_lease_id: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          applied_revision?: number
          created_at?: string
          desired_addresses?: string[]
          desired_domains?: number[]
          desired_revision?: number
          last_attempted_revision?: number | null
          last_error_code?: string | null
          last_error_retryable?: boolean | null
          last_remote_addresses?: string[]
          last_remote_domains?: number[]
          last_remote_verified_at?: string | null
          subscription_id: string
          sync_lease_expires_at?: string | null
          sync_lease_id?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          applied_revision?: number
          created_at?: string
          desired_addresses?: string[]
          desired_domains?: number[]
          desired_revision?: number
          last_attempted_revision?: number | null
          last_error_code?: string | null
          last_error_retryable?: boolean | null
          last_remote_addresses?: string[]
          last_remote_domains?: number[]
          last_remote_verified_at?: string | null
          subscription_id?: string
          sync_lease_expires_at?: string | null
          sync_lease_id?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      circle_gateway_webhook_tests: {
        Row: {
          notification_id: string
          received_at: string
          subscription_id: string
        }
        Insert: {
          notification_id: string
          received_at?: string
          subscription_id: string
        }
        Update: {
          notification_id?: string
          received_at?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_gateway_webhook_tests_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "circle_gateway_subscriptions"
            referencedColumns: ["subscription_id"]
          },
        ]
      }
      escrow_contracts: {
        Row: {
          artifact_checksum: string | null
          chain_id: number
          circle_contract_id: string | null
          circle_transaction_id: string | null
          contract_address: string | null
          contract_version: string | null
          created_at: string
          deploy_idempotency_key: string | null
          deployed_at: string | null
          deployment_block_hash: string | null
          deployment_block_number: number | null
          deployment_status: string
          deployment_transaction_hash: string | null
          deployment_wallet_reference: string | null
          failure_code: string | null
          id: string
          immutable_references: Json | null
          last_synced_block: number | null
          late_funding_scanned_through_block: number | null
          owner_wallet: string | null
          program_id: string
          program_key: string | null
          refund_unlock_at: string | null
          runtime_bytecode_checksum: string | null
          token_address: string | null
          token_decimals: number | null
          updated_at: string
          withdraw_recipient: string | null
        }
        Insert: {
          artifact_checksum?: string | null
          chain_id: number
          circle_contract_id?: string | null
          circle_transaction_id?: string | null
          contract_address?: string | null
          contract_version?: string | null
          created_at?: string
          deploy_idempotency_key?: string | null
          deployed_at?: string | null
          deployment_block_hash?: string | null
          deployment_block_number?: number | null
          deployment_status?: string
          deployment_transaction_hash?: string | null
          deployment_wallet_reference?: string | null
          failure_code?: string | null
          id?: string
          immutable_references?: Json | null
          last_synced_block?: number | null
          late_funding_scanned_through_block?: number | null
          owner_wallet?: string | null
          program_id: string
          program_key?: string | null
          refund_unlock_at?: string | null
          runtime_bytecode_checksum?: string | null
          token_address?: string | null
          token_decimals?: number | null
          updated_at?: string
          withdraw_recipient?: string | null
        }
        Update: {
          artifact_checksum?: string | null
          chain_id?: number
          circle_contract_id?: string | null
          circle_transaction_id?: string | null
          contract_address?: string | null
          contract_version?: string | null
          created_at?: string
          deploy_idempotency_key?: string | null
          deployed_at?: string | null
          deployment_block_hash?: string | null
          deployment_block_number?: number | null
          deployment_status?: string
          deployment_transaction_hash?: string | null
          deployment_wallet_reference?: string | null
          failure_code?: string | null
          id?: string
          immutable_references?: Json | null
          last_synced_block?: number | null
          late_funding_scanned_through_block?: number | null
          owner_wallet?: string | null
          program_id?: string
          program_key?: string | null
          refund_unlock_at?: string | null
          runtime_bytecode_checksum?: string | null
          token_address?: string | null
          token_decimals?: number | null
          updated_at?: string
          withdraw_recipient?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escrow_contracts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      escrow_transactions: {
        Row: {
          amount: number
          block_hash: string | null
          block_number: number | null
          chain_id: number
          confirmations: number
          confirmed_at: string | null
          created_at: string
          escrow_contract_id: string
          failure_code: string | null
          from_address: string | null
          funding_intent_id: string | null
          id: string
          log_index: number | null
          program_id: string
          report_id: string | null
          status: string
          to_address: string | null
          token_address: string
          transaction_hash: string
          transaction_type: string
          updated_at: string
          withdrawal_intent_id: string | null
        }
        Insert: {
          amount: number
          block_hash?: string | null
          block_number?: number | null
          chain_id: number
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          escrow_contract_id: string
          failure_code?: string | null
          from_address?: string | null
          funding_intent_id?: string | null
          id?: string
          log_index?: number | null
          program_id: string
          report_id?: string | null
          status?: string
          to_address?: string | null
          token_address: string
          transaction_hash: string
          transaction_type: string
          updated_at?: string
          withdrawal_intent_id?: string | null
        }
        Update: {
          amount?: number
          block_hash?: string | null
          block_number?: number | null
          chain_id?: number
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          escrow_contract_id?: string
          failure_code?: string | null
          from_address?: string | null
          funding_intent_id?: string | null
          id?: string
          log_index?: number | null
          program_id?: string
          report_id?: string | null
          status?: string
          to_address?: string | null
          token_address?: string
          transaction_hash?: string
          transaction_type?: string
          updated_at?: string
          withdrawal_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escrow_transactions_contract_program_chain_fkey"
            columns: ["escrow_contract_id", "program_id", "chain_id"]
            isOneToOne: false
            referencedRelation: "escrow_contracts"
            referencedColumns: ["id", "program_id", "chain_id"]
          },
          {
            foreignKeyName: "escrow_transactions_escrow_contract_id_fkey"
            columns: ["escrow_contract_id"]
            isOneToOne: false
            referencedRelation: "escrow_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_transactions_funding_intent_id_fkey"
            columns: ["funding_intent_id"]
            isOneToOne: false
            referencedRelation: "funding_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_transactions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_transactions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_transactions_report_program_fkey"
            columns: ["report_id", "program_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id", "program_id"]
          },
          {
            foreignKeyName: "escrow_transactions_withdrawal_intent_id_fkey"
            columns: ["withdrawal_intent_id"]
            isOneToOne: false
            referencedRelation: "withdrawal_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_confirmation_artifacts: {
        Row: {
          artifact_checksum: string
          artifact_version: string
          available_pool: number
          destination_block_hash: string
          destination_block_number: number
          destination_log_index: number
          destination_transaction_hash: string
          escrow_address: string
          escrow_contract_id: string
          estimated_fee_reserve_base_units: number
          funding_intent_id: string
          gross_amount_base_units: number
          net_received_base_units: number
          paid_pool: number
          post_total_funded_base_units: number
          pre_total_funded_base_units: number
          program_id: string
          reconciled_at: string
          required_total_funded_base_units: number
          reserved_pool: number
          route_mode: string
          sync_block_hash: string
          sync_block_number: number
          sync_log_index: number | null
          sync_transaction_hash: string
          token_address: string
          token_decimals: number
          total_pool: number
          withdrawn_pool: number
        }
        Insert: {
          artifact_checksum: string
          artifact_version: string
          available_pool: number
          destination_block_hash: string
          destination_block_number: number
          destination_log_index: number
          destination_transaction_hash: string
          escrow_address: string
          escrow_contract_id: string
          estimated_fee_reserve_base_units: number
          funding_intent_id: string
          gross_amount_base_units: number
          net_received_base_units: number
          paid_pool: number
          post_total_funded_base_units: number
          pre_total_funded_base_units: number
          program_id: string
          reconciled_at?: string
          required_total_funded_base_units: number
          reserved_pool: number
          route_mode: string
          sync_block_hash: string
          sync_block_number: number
          sync_log_index?: number | null
          sync_transaction_hash: string
          token_address: string
          token_decimals: number
          total_pool: number
          withdrawn_pool: number
        }
        Update: {
          artifact_checksum?: string
          artifact_version?: string
          available_pool?: number
          destination_block_hash?: string
          destination_block_number?: number
          destination_log_index?: number
          destination_transaction_hash?: string
          escrow_address?: string
          escrow_contract_id?: string
          estimated_fee_reserve_base_units?: number
          funding_intent_id?: string
          gross_amount_base_units?: number
          net_received_base_units?: number
          paid_pool?: number
          post_total_funded_base_units?: number
          pre_total_funded_base_units?: number
          program_id?: string
          reconciled_at?: string
          required_total_funded_base_units?: number
          reserved_pool?: number
          route_mode?: string
          sync_block_hash?: string
          sync_block_number?: number
          sync_log_index?: number | null
          sync_transaction_hash?: string
          token_address?: string
          token_decimals?: number
          total_pool?: number
          withdrawn_pool?: number
        }
        Relationships: [
          {
            foreignKeyName: "funding_confirmation_artifacts_escrow_contract_id_fkey"
            columns: ["escrow_contract_id"]
            isOneToOne: false
            referencedRelation: "escrow_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_confirmation_artifacts_funding_intent_id_fkey"
            columns: ["funding_intent_id"]
            isOneToOne: true
            referencedRelation: "funding_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_confirmation_artifacts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_intents: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          destination_address: string
          destination_chain: string
          destination_transaction_hash: string | null
          escrow_contract_id: string
          estimated_fee_reserve_base_units: number
          expires_at: string
          failure_code: string | null
          fee_allocations: Json
          gross_amount_base_units: number
          id: string
          idempotency_key: string
          net_received_base_units: number | null
          pre_balance_base_units: number
          pre_total_funded_base_units: number
          program_id: string
          quote_expires_at: string | null
          quote_quoted_at: string | null
          reconcile_lease_expires_at: string | null
          reconcile_lease_id: string | null
          route_mode: string
          sources: Json
          status: string
          sync_circle_transaction_id: string | null
          sync_idempotency_key: string
          transfer_id: string | null
          updated_at: string
          wallet_address: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          destination_address: string
          destination_chain?: string
          destination_transaction_hash?: string | null
          escrow_contract_id: string
          estimated_fee_reserve_base_units: number
          expires_at: string
          failure_code?: string | null
          fee_allocations: Json
          gross_amount_base_units: number
          id?: string
          idempotency_key: string
          net_received_base_units?: number | null
          pre_balance_base_units: number
          pre_total_funded_base_units: number
          program_id: string
          quote_expires_at?: string | null
          quote_quoted_at?: string | null
          reconcile_lease_expires_at?: string | null
          reconcile_lease_id?: string | null
          route_mode: string
          sources: Json
          status?: string
          sync_circle_transaction_id?: string | null
          sync_idempotency_key?: string
          transfer_id?: string | null
          updated_at?: string
          wallet_address: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          destination_address?: string
          destination_chain?: string
          destination_transaction_hash?: string | null
          escrow_contract_id?: string
          estimated_fee_reserve_base_units?: number
          expires_at?: string
          failure_code?: string | null
          fee_allocations?: Json
          gross_amount_base_units?: number
          id?: string
          idempotency_key?: string
          net_received_base_units?: number | null
          pre_balance_base_units?: number
          pre_total_funded_base_units?: number
          program_id?: string
          quote_expires_at?: string | null
          quote_quoted_at?: string | null
          reconcile_lease_expires_at?: string | null
          reconcile_lease_id?: string | null
          route_mode?: string
          sources?: Json
          status?: string
          sync_circle_transaction_id?: string | null
          sync_idempotency_key?: string
          transfer_id?: string | null
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_intents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_intents_escrow_contract_id_fkey"
            columns: ["escrow_contract_id"]
            isOneToOne: false
            referencedRelation: "escrow_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_intents_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_operations: {
        Row: {
          attempt_no: number
          block_hash: string | null
          block_number: number | null
          created_at: string
          event_chain_id: number | null
          failure_code: string | null
          funding_intent_id: string
          gateway_wallet_address: string | null
          id: string
          log_index: number | null
          net_received_base_units: number | null
          operation_id: string | null
          operation_type: string
          pre_gateway_balance_base_units: number | null
          provider_state: string | null
          replaces_operation_id: string | null
          requested_amount_base_units: number | null
          retryable: boolean
          source_address: string | null
          source_chain: string | null
          source_chain_id: number | null
          source_token_address: string | null
          status: string
          steps: Json
          submission_uncertain: boolean
          transaction_hash: string | null
          transfer_id: string | null
          transfer_log_index: number | null
          updated_at: string
        }
        Insert: {
          attempt_no?: number
          block_hash?: string | null
          block_number?: number | null
          created_at?: string
          event_chain_id?: number | null
          failure_code?: string | null
          funding_intent_id: string
          gateway_wallet_address?: string | null
          id?: string
          log_index?: number | null
          net_received_base_units?: number | null
          operation_id?: string | null
          operation_type: string
          pre_gateway_balance_base_units?: number | null
          provider_state?: string | null
          replaces_operation_id?: string | null
          requested_amount_base_units?: number | null
          retryable?: boolean
          source_address?: string | null
          source_chain?: string | null
          source_chain_id?: number | null
          source_token_address?: string | null
          status: string
          steps?: Json
          submission_uncertain?: boolean
          transaction_hash?: string | null
          transfer_id?: string | null
          transfer_log_index?: number | null
          updated_at?: string
        }
        Update: {
          attempt_no?: number
          block_hash?: string | null
          block_number?: number | null
          created_at?: string
          event_chain_id?: number | null
          failure_code?: string | null
          funding_intent_id?: string
          gateway_wallet_address?: string | null
          id?: string
          log_index?: number | null
          net_received_base_units?: number | null
          operation_id?: string | null
          operation_type?: string
          pre_gateway_balance_base_units?: number | null
          provider_state?: string | null
          replaces_operation_id?: string | null
          requested_amount_base_units?: number | null
          retryable?: boolean
          source_address?: string | null
          source_chain?: string | null
          source_chain_id?: number | null
          source_token_address?: string | null
          status?: string
          steps?: Json
          submission_uncertain?: boolean
          transaction_hash?: string | null
          transfer_id?: string | null
          transfer_log_index?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_operations_funding_intent_id_fkey"
            columns: ["funding_intent_id"]
            isOneToOne: false
            referencedRelation: "funding_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_operations_replaces_operation_id_fkey"
            columns: ["replaces_operation_id"]
            isOneToOne: false
            referencedRelation: "funding_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          read_at: string | null
          recipient_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          onboarding_completed_at: string | null
          role: string
          updated_at: string
          wallet_address: string | null
          wallet_updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          onboarding_completed_at?: string | null
          role?: string
          updated_at?: string
          wallet_address?: string | null
          wallet_updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          onboarding_completed_at?: string | null
          role?: string
          updated_at?: string
          wallet_address?: string | null
          wallet_updated_at?: string | null
        }
        Relationships: []
      }
      program_impacts: {
        Row: {
          archived_at: string | null
          asset_type: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          normalized_title: string | null
          program_id: string
          severity: string
          sort_order: number
          source: string
          template_key: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          asset_type: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          normalized_title?: string | null
          program_id: string
          severity: string
          sort_order?: number
          source?: string
          template_key?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          asset_type?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          normalized_title?: string | null
          program_id?: string
          severity?: string
          sort_order?: number
          source?: string
          template_key?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_impacts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_prohibited_activities: {
        Row: {
          body: string
          created_at: string
          id: string
          program_id: string
          rule_key: string | null
          sort_order: number
          source: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          program_id: string
          rule_key?: string | null
          sort_order?: number
          source: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          program_id?: string
          rule_key?: string | null
          sort_order?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_prohibited_activities_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_resources: {
        Row: {
          created_at: string
          id: string
          program_id: string
          resource_type: string
          sort_order: number
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          program_id: string
          resource_type: string
          sort_order?: number
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          program_id?: string
          resource_type?: string
          sort_order?: number
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_resources_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_reviewers: {
        Row: {
          assigned_by: string | null
          created_at: string
          program_id: string
          reviewer_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          program_id: string
          reviewer_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          program_id?: string
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_reviewers_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_reviewers_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_reviewers_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      program_reward_tiers: {
        Row: {
          archived_at: string | null
          asset_type: string
          calculation_note: string | null
          calculation_type: string
          created_at: string
          flat_amount: number | null
          id: string
          max_reward: number | null
          max_reward_cap: number | null
          min_reward: number | null
          percentage_bps: number | null
          program_id: string
          severity: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          asset_type: string
          calculation_note?: string | null
          calculation_type?: string
          created_at?: string
          flat_amount?: number | null
          id?: string
          max_reward?: number | null
          max_reward_cap?: number | null
          min_reward?: number | null
          percentage_bps?: number | null
          program_id: string
          severity: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          asset_type?: string
          calculation_note?: string | null
          calculation_type?: string
          created_at?: string
          flat_amount?: number | null
          id?: string
          max_reward?: number | null
          max_reward_cap?: number | null
          min_reward?: number | null
          percentage_bps?: number | null
          program_id?: string
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_reward_tiers_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_scopes: {
        Row: {
          archived_at: string | null
          asset_name: string
          asset_type: string
          asset_url: string | null
          contract_address: string | null
          created_at: string
          description: string | null
          id: string
          is_in_scope: boolean
          program_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          asset_name: string
          asset_type: string
          asset_url?: string | null
          contract_address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_in_scope?: boolean
          program_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          asset_name?: string
          asset_type?: string
          asset_url?: string | null
          contract_address?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_in_scope?: boolean
          program_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_scopes_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_tags: {
        Row: {
          created_at: string
          id: string
          label: string
          normalized_tag: string | null
          program_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          normalized_tag?: string | null
          program_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          normalized_tag?: string | null
          program_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_tags_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          allow_custom_impact: boolean
          available_pool: number | null
          closed_at: string | null
          contract_address: string | null
          created_at: string
          deadline: string | null
          description: string
          id: string
          in_scope_asset_types: string[]
          logo_storage_path: string | null
          max_bounty: number
          name: string
          owner_id: string
          paid_pool: number
          paid_report_count: number
          poc_policy: string
          poc_policy_note: string | null
          public_paid_pool: number | null
          public_status: string | null
          published_at: string | null
          reserved_pool: number
          reward_policy: string | null
          reward_severities: string[]
          short_summary: string
          slug: string
          status: string
          submission_acknowledgment: string | null
          testing_restrictions: string | null
          total_paid_visibility: string
          total_pool: number
          updated_at: string
          website_url: string | null
          withdrawn_pool: number
        }
        Insert: {
          allow_custom_impact?: boolean
          available_pool?: number | null
          closed_at?: string | null
          contract_address?: string | null
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          in_scope_asset_types?: string[]
          logo_storage_path?: string | null
          max_bounty?: number
          name: string
          owner_id: string
          paid_pool?: number
          paid_report_count?: number
          poc_policy?: string
          poc_policy_note?: string | null
          public_paid_pool?: number | null
          public_status?: string | null
          published_at?: string | null
          reserved_pool?: number
          reward_policy?: string | null
          reward_severities?: string[]
          short_summary: string
          slug: string
          status?: string
          submission_acknowledgment?: string | null
          testing_restrictions?: string | null
          total_paid_visibility?: string
          total_pool?: number
          updated_at?: string
          website_url?: string | null
          withdrawn_pool?: number
        }
        Update: {
          allow_custom_impact?: boolean
          available_pool?: number | null
          closed_at?: string | null
          contract_address?: string | null
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          in_scope_asset_types?: string[]
          logo_storage_path?: string | null
          max_bounty?: number
          name?: string
          owner_id?: string
          paid_pool?: number
          paid_report_count?: number
          poc_policy?: string
          poc_policy_note?: string | null
          public_paid_pool?: number | null
          public_status?: string | null
          published_at?: string | null
          reserved_pool?: number
          reward_policy?: string | null
          reward_severities?: string[]
          short_summary?: string
          slug?: string
          status?: string
          submission_acknowledgment?: string | null
          testing_restrictions?: string | null
          total_paid_visibility?: string
          total_pool?: number
          updated_at?: string
          website_url?: string | null
          withdrawn_pool?: number
        }
        Relationships: [
          {
            foreignKeyName: "programs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_attachments: {
        Row: {
          checksum_sha256: string | null
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          report_id: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          upload_status: string
          uploaded_at: string | null
          uploader_id: string
        }
        Insert: {
          checksum_sha256?: string | null
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          report_id: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          upload_status?: string
          uploaded_at?: string | null
          uploader_id: string
        }
        Update: {
          checksum_sha256?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          report_id?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          upload_status?: string
          uploaded_at?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          report_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          report_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_comments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_disclosures: {
        Row: {
          created_at: string
          decided_at: string
          decided_by: string
          decision: string
          id: string
          program_id: string
          public_content: string | null
          public_severity: string | null
          public_summary: string | null
          public_title: string | null
          published_at: string | null
          report_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string
          decided_by: string
          decision: string
          id?: string
          program_id: string
          public_content?: string | null
          public_severity?: string | null
          public_summary?: string | null
          public_title?: string | null
          published_at?: string | null
          report_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string
          decided_by?: string
          decision?: string
          id?: string
          program_id?: string
          public_content?: string | null
          public_severity?: string | null
          public_summary?: string | null
          public_title?: string | null
          published_at?: string | null
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_disclosures_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_disclosures_report_fkey"
            columns: ["report_id", "program_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id", "program_id"]
          },
        ]
      }
      report_impacts: {
        Row: {
          asset_type_snapshot: string
          created_at: string
          custom_title: string | null
          id: string
          impact_severity_snapshot: string | null
          impact_title_snapshot: string
          program_id: string
          program_impact_id: string | null
          report_id: string
          source: string
        }
        Insert: {
          asset_type_snapshot: string
          created_at?: string
          custom_title?: string | null
          id?: string
          impact_severity_snapshot?: string | null
          impact_title_snapshot: string
          program_id: string
          program_impact_id?: string | null
          report_id: string
          source: string
        }
        Update: {
          asset_type_snapshot?: string
          created_at?: string
          custom_title?: string | null
          id?: string
          impact_severity_snapshot?: string | null
          impact_title_snapshot?: string
          program_id?: string
          program_impact_id?: string | null
          report_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_impacts_program_impact_fkey"
            columns: ["program_impact_id", "program_id", "asset_type_snapshot"]
            isOneToOne: false
            referencedRelation: "program_impacts"
            referencedColumns: ["id", "program_id", "asset_type"]
          },
          {
            foreignKeyName: "report_impacts_report_fkey"
            columns: ["report_id", "program_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id", "program_id"]
          },
        ]
      }
      report_reviews: {
        Row: {
          action: string
          created_at: string
          from_status: string
          id: string
          metadata: Json
          reason: string | null
          report_id: string
          reviewer_id: string
          to_status: string
        }
        Insert: {
          action: string
          created_at?: string
          from_status: string
          id?: string
          metadata?: Json
          reason?: string | null
          report_id: string
          reviewer_id: string
          to_status: string
        }
        Update: {
          action?: string
          created_at?: string
          from_status?: string
          id?: string
          metadata?: Json
          reason?: string | null
          report_id?: string
          reviewer_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_reviews_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          affected_scope_id: string
          approved_reward: number | null
          content_hash: string
          created_at: string
          description: string
          final_severity: string | null
          id: string
          paid_at: string | null
          program_id: string
          proposed_severity: string
          reproduction_steps: string | null
          researcher_id: string
          reward_approved_at: string | null
          secret_gist_url: string | null
          severity_mismatch_acknowledged: boolean
          status: string
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          affected_scope_id: string
          approved_reward?: number | null
          content_hash: string
          created_at?: string
          description: string
          final_severity?: string | null
          id?: string
          paid_at?: string | null
          program_id: string
          proposed_severity: string
          reproduction_steps?: string | null
          researcher_id: string
          reward_approved_at?: string | null
          secret_gist_url?: string | null
          severity_mismatch_acknowledged?: boolean
          status?: string
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          affected_scope_id?: string
          approved_reward?: number | null
          content_hash?: string
          created_at?: string
          description?: string
          final_severity?: string | null
          id?: string
          paid_at?: string | null
          program_id?: string
          proposed_severity?: string
          reproduction_steps?: string | null
          researcher_id?: string
          reward_approved_at?: string | null
          secret_gist_url?: string | null
          severity_mismatch_acknowledged?: boolean
          status?: string
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_affected_scope_id_fkey"
            columns: ["affected_scope_id"]
            isOneToOne: false
            referencedRelation: "program_scopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_affected_scope_program_fkey"
            columns: ["affected_scope_id", "program_id"]
            isOneToOne: false
            referencedRelation: "program_scopes"
            referencedColumns: ["id", "program_id"]
          },
          {
            foreignKeyName: "reports_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_researcher_id_fkey"
            columns: ["researcher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          applied_at: string
          version: string
        }
        Insert: {
          applied_at?: string
          version: string
        }
        Update: {
          applied_at?: string
          version?: string
        }
        Relationships: []
      }
      withdrawal_intents: {
        Row: {
          amount_base_units: number
          close_block_hash: string | null
          close_block_number: number | null
          close_log_index: number | null
          close_required: boolean
          close_transaction_hash: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          escrow_contract_id: string
          failure_code: string | null
          id: string
          idempotency_key: string
          pre_total_withdrawn_base_units: number
          program_id: string
          recipient_address: string
          status: string
          transfer_log_index: number | null
          updated_at: string
          wallet_address: string
          withdraw_block_hash: string | null
          withdraw_block_number: number | null
          withdraw_log_index: number | null
          withdraw_transaction_hash: string | null
        }
        Insert: {
          amount_base_units: number
          close_block_hash?: string | null
          close_block_number?: number | null
          close_log_index?: number | null
          close_required: boolean
          close_transaction_hash?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          escrow_contract_id: string
          failure_code?: string | null
          id?: string
          idempotency_key: string
          pre_total_withdrawn_base_units: number
          program_id: string
          recipient_address: string
          status: string
          transfer_log_index?: number | null
          updated_at?: string
          wallet_address: string
          withdraw_block_hash?: string | null
          withdraw_block_number?: number | null
          withdraw_log_index?: number | null
          withdraw_transaction_hash?: string | null
        }
        Update: {
          amount_base_units?: number
          close_block_hash?: string | null
          close_block_number?: number | null
          close_log_index?: number | null
          close_required?: boolean
          close_transaction_hash?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          escrow_contract_id?: string
          failure_code?: string | null
          id?: string
          idempotency_key?: string
          pre_total_withdrawn_base_units?: number
          program_id?: string
          recipient_address?: string
          status?: string
          transfer_log_index?: number | null
          updated_at?: string
          wallet_address?: string
          withdraw_block_hash?: string | null
          withdraw_block_number?: number | null
          withdraw_log_index?: number | null
          withdraw_transaction_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_intents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_intents_escrow_contract_id_fkey"
            columns: ["escrow_contract_id"]
            isOneToOne: false
            referencedRelation: "escrow_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_intents_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      actor_can_review_program: {
        Args: { actor_id: string; target_program_id: string }
        Returns: boolean
      }
      add_report_comment_atomic: {
        Args: {
          actor_id: string
          comment_body: string
          target_report_id: string
        }
        Returns: string
      }
      approve_report_reward_atomic: {
        Args: {
          actor_id: string
          calculation_basis_amount?: number
          reward_amount: number
          target_report_id: string
        }
        Returns: string
      }
      assert_program_asset_types_scoped: {
        Args: { target_program_id: string }
        Returns: undefined
      }
      assert_program_coverage: {
        Args: { target_program_id: string }
        Returns: undefined
      }
      assert_program_owner: {
        Args: { actor_id: string; target_program_id: string }
        Returns: {
          allow_custom_impact: boolean
          available_pool: number | null
          closed_at: string | null
          contract_address: string | null
          created_at: string
          deadline: string | null
          description: string
          id: string
          in_scope_asset_types: string[]
          logo_storage_path: string | null
          max_bounty: number
          name: string
          owner_id: string
          paid_pool: number
          paid_report_count: number
          poc_policy: string
          poc_policy_note: string | null
          public_paid_pool: number | null
          public_status: string | null
          published_at: string | null
          reserved_pool: number
          reward_policy: string | null
          reward_severities: string[]
          short_summary: string
          slug: string
          status: string
          submission_acknowledgment: string | null
          testing_restrictions: string | null
          total_paid_visibility: string
          total_pool: number
          updated_at: string
          website_url: string | null
          withdrawn_pool: number
        }
        SetofOptions: {
          from: "*"
          to: "programs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_program_reviewer_atomic: {
        Args: {
          actor_id: string
          target_program_id: string
          target_reviewer_id: string
        }
        Returns: string
      }
      can_access_report: {
        Args: { target_report_id: string }
        Returns: boolean
      }
      can_review_report: {
        Args: { target_report_id: string }
        Returns: boolean
      }
      claim_funding_reconciliation_atomic: {
        Args: {
          requested_lease_expires_at: string
          requested_lease_id: string
          target_intent_id: string
        }
        Returns: boolean
      }
      complete_gateway_subscription_sync_atomic: {
        Args: {
          lease_id: string
          remote_addresses: Json
          remote_domains: Json
          subscription_id: string
          synced_revision: number
        }
        Returns: boolean
      }
      complete_profile_onboarding: {
        Args: { selected_display_name: string; selected_role: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          onboarding_completed_at: string | null
          role: string
          updated_at: string
          wallet_address: string | null
          wallet_updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_profile_onboarding_for_user: {
        Args: {
          selected_display_name: string
          selected_role: string
          target_user_id: string
        }
        Returns: string
      }
      complete_report_attachment_atomic: {
        Args: {
          actor_id: string
          attachment_id: string
          target_report_id: string
        }
        Returns: string
      }
      confirm_escrow_deployment_atomic: {
        Args: {
          target_deployment_id: string
          verified_block_hash: string
          verified_block_number: number
          verified_contract_address: string
          verified_deployment_wallet_reference: string
          verified_transaction_hash: string
        }
        Returns: boolean
      }
      confirm_report_payment_atomic: {
        Args: {
          actor_id: string
          settled_block_hash: string
          settled_block_number: number
          settled_confirmations: number
          target_report_id: string
        }
        Returns: string
      }
      confirm_source_deposit_atomic: {
        Args: {
          target_deposit_id: string
          verified_block_hash: string
          verified_block_number: number
          verified_log_index: number
          verified_transaction_hash: string
        }
        Returns: boolean
      }
      confirm_withdrawal_close_atomic: {
        Args: {
          target_intent_id: string
          verified_close_block_hash: string
          verified_close_block_number: number
          verified_close_hash: string
          verified_close_log_index: number
        }
        Returns: boolean
      }
      create_escrow_deployment_atomic: {
        Args: {
          actor_id: string
          target_artifact_checksum: string
          target_idempotency_key: string
          target_immutable_references: Json
          target_owner_wallet: string
          target_program_id: string
          target_program_key: string
          target_refund_unlock_at: string
          target_runtime_checksum: string
          target_withdraw_recipient: string
        }
        Returns: string
      }
      create_funding_intent_atomic: {
        Args: {
          actor_id: string
          escrow_pre_balance_base_units: number
          escrow_pre_total_funded_base_units: number
          fee_reserve_base_units: number
          gross_base_units: number
          initial_quote_expires_at: string
          initial_quote_quoted_at: string
          intent_expires_at: string
          request_idempotency_key: string
          requested_fee_allocations: Json
          requested_sources: Json
          source_wallet: string
          target_program_id: string
        }
        Returns: string
      }
      create_program_atomic: {
        Args: { actor_id: string; input: Json }
        Returns: string
      }
      create_source_deposit_atomic: {
        Args: {
          actor_id: string
          gateway_pre_balance_base_units: number
          locked_amount_base_units: number
          locked_chain_id: number
          locked_gateway_wallet_address: string
          locked_token_address: string
          locked_wallet_address: string
          source_network: string
          target_intent_id: string
          target_program_id: string
        }
        Returns: string
      }
      create_withdrawal_intent_atomic: {
        Args: {
          actor_id: string
          escrow_already_closed: boolean
          escrow_pre_total_withdrawn_base_units: number
          expected_amount_base_units: number
          request_idempotency_key: string
          source_wallet: string
          target_program_id: string
        }
        Returns: string
      }
      decide_report_disclosure_atomic: {
        Args: {
          actor_id: string
          decision: string
          disclosure_content: string
          disclosure_severity: string
          disclosure_summary: string
          disclosure_title: string
          target_report_id: string
        }
        Returns: string
      }
      fail_funding_destination_reverted_atomic: {
        Args: { target_intent_id: string; verified_transaction_hash: string }
        Returns: boolean
      }
      fail_funding_sync_atomic: {
        Args: {
          requested_lease_id: string
          target_intent_id: string
          verified_circle_transaction_id: string
          verified_failure_code: string
        }
        Returns: boolean
      }
      fail_gateway_subscription_sync_atomic: {
        Args: {
          error_code: string
          lease_id: string
          retryable: boolean
          subscription_id: string
        }
        Returns: boolean
      }
      fail_source_deposit_reverted_atomic: {
        Args: { target_deposit_id: string; verified_transaction_hash: string }
        Returns: boolean
      }
      fail_withdrawal_intent_atomic: {
        Args: {
          expected_transaction_hash: string
          target_intent_id: string
          terminal_failure_code: string
        }
        Returns: boolean
      }
      gateway_subscription_intent_ready: {
        Args: { intent_id: string; subscription_id: string }
        Returns: boolean
      }
      gateway_webhook_test_received_after: {
        Args: { received_after: string; subscription_id: string }
        Returns: boolean
      }
      ingest_circle_gateway_deposit_finalized_atomic: {
        Args: {
          amount_base_units: number
          event_id: string
          event_timestamp: string
          from_address: string
          notification_id: string
          payload_version: number
          source_domain: number
          subscription_id: string
          to_address: string
          token_address: string
          transaction_hash: string
          wallet_address: string
        }
        Returns: boolean
      }
      is_active_auth_user: { Args: never; Returns: boolean }
      is_program_owner: {
        Args: { target_program_id: string }
        Returns: boolean
      }
      is_program_readable: {
        Args: { target_program_id: string }
        Returns: boolean
      }
      is_program_reviewer: {
        Args: { target_program_id: string }
        Returns: boolean
      }
      jsonb_contains_forbidden_metadata_key: {
        Args: { payload: Json }
        Returns: boolean
      }
      list_active_unified_balance_gateway_intent_ids: {
        Args: never
        Returns: {
          intent_id: string
        }[]
      }
      mark_notifications_read_atomic: {
        Args: { actor_id: string; notification_ids: string[] }
        Returns: number
      }
      mark_report_duplicate_atomic: {
        Args: {
          actor_id: string
          original_report_id: string
          target_report_id: string
          transition_reason: string
        }
        Returns: string
      }
      observe_funding_operation_atomic: {
        Args: {
          observed_destination_hash: string
          observed_operation_id: string
          observed_provider_state: string
          observed_retryable: boolean
          observed_source_hashes: Json
          observed_steps: Json
          observed_submission_uncertain: boolean
          observed_transfer_id: string
          target_intent_id: string
        }
        Returns: boolean
      }
      observe_source_deposit_atomic: {
        Args: {
          actor_id: string
          observed_failure_code: string
          observed_outcome: string
          observed_transaction_hash: string
          target_deposit_id: string
          target_intent_id: string
          target_program_id: string
        }
        Returns: boolean
      }
      observe_withdrawal_operation_atomic:
        | {
            Args: {
              observed_operation: string
              observed_transaction_hash: string
              target_intent_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              observed_operation: string
              observed_outcome: string
              observed_transaction_hash: string
              target_intent_id: string
            }
            Returns: boolean
          }
      platform_prohibited_activities: {
        Args: never
        Returns: {
          body: string
          rule_key: string
          sort_order: number
        }[]
      }
      prepare_gateway_subscription_registration_atomic: {
        Args: {
          requested_lease_expires_at: string
          requested_lease_id: string
          target_intent_id: string
          target_subscription_id: string
        }
        Returns: Json
      }
      prepare_report_attachment_atomic: {
        Args: {
          actor_id: string
          attachment_id: string
          attachment_size: number
          checksum: string
          filename: string
          media_type: string
          target_report_id: string
        }
        Returns: string
      }
      program_median_resolution_seconds: {
        Args: { target_program_id: string }
        Returns: number
      }
      publish_program_atomic: {
        Args: { actor_id: string; target_program_id: string }
        Returns: string
      }
      reconcile_funding_intent_atomic: {
        Args: {
          destination_block_hash: string
          destination_block_number: number
          destination_hash: string
          destination_log_index: number
          requested_lease_id: string
          sync_block_hash: string
          sync_block_number: number
          sync_hash: string
          sync_log_index: number
          target_intent_id: string
          verified_net_base_units: number
          verified_post_total_funded_base_units: number
        }
        Returns: boolean
      }
      reconcile_late_funding_atomic:
        | {
            Args: {
              actor_id: string
              scanned_through_block: number
              target_escrow_id: string
              target_program_id: string
              verified_events: Json
            }
            Returns: number
          }
        | {
            Args: {
              actor_id: string
              advance_cursor: boolean
              scanned_through_block: number
              target_escrow_id: string
              target_program_id: string
              verified_events: Json
            }
            Returns: number
          }
      reconcile_withdrawal_intent_atomic: {
        Args: {
          target_intent_id: string
          verified_amount_base_units: number
          verified_block_hash: string
          verified_block_number: number
          verified_transfer_log_index: number
          verified_withdraw_hash: string
          verified_withdraw_log_index: number
        }
        Returns: boolean
      }
      record_gateway_webhook_test_atomic: {
        Args: {
          notification_id: string
          received_at: string
          subscription_id: string
        }
        Returns: boolean
      }
      record_source_deposit_onchain_verified_atomic: {
        Args: {
          target_deposit_id: string
          verified_block_hash: string
          verified_block_number: number
          verified_gateway_log_index: number
          verified_transaction_hash: string
          verified_transfer_log_index: number
        }
        Returns: boolean
      }
      refresh_funding_quote_atomic: {
        Args: {
          actor_id: string
          refreshed_expires_at: string
          refreshed_fee_allocations: Json
          refreshed_fee_reserve_base_units: number
          refreshed_quoted_at: string
          target_intent_id: string
          target_program_id: string
        }
        Returns: boolean
      }
      refresh_program_projection: {
        Args: { target_program_id: string }
        Returns: undefined
      }
      reject_business: { Args: { reason: string }; Returns: undefined }
      reject_forbidden: { Args: { reason: string }; Returns: undefined }
      reject_missing: { Args: { reason: string }; Returns: undefined }
      reject_report_atomic: {
        Args: {
          actor_id: string
          target_report_id: string
          transition_reason: string
        }
        Returns: string
      }
      remove_program_reviewer_atomic: {
        Args: {
          actor_id: string
          target_program_id: string
          target_reviewer_id: string
        }
        Returns: string
      }
      request_report_information_atomic: {
        Args: {
          actor_id: string
          target_report_id: string
          transition_reason: string
        }
        Returns: string
      }
      researcher_payout_wallet: {
        Args: { actor_id: string }
        Returns: {
          has_active_rewards: boolean
          wallet_address: string
          wallet_updated_at: string
        }[]
      }
      researcher_report_program_filter_options: {
        Args: { actor_id: string }
        Returns: {
          id: string
          name: string
          report_count: number
          slug: string
        }[]
      }
      researcher_report_summary: {
        Args: { actor_id: string }
        Returns: {
          all_reports: number
          needs_information: number
          rewards_paid: string
          under_review: number
        }[]
      }
      researcher_rewards: {
        Args: {
          actor_id: string
          page_offset: number
          page_size: number
          requested_status: string
        }
        Returns: {
          approved_reward: string
          final_severity: string
          paid_at: string
          payment_chain_id: string
          payment_confirmations: number
          payment_confirmed_at: string
          payment_status: string
          payment_token_address: string
          payment_transaction_hash: string
          program_id: string
          program_name: string
          report_id: string
          report_title: string
          reward_approved_at: string
          reward_status: string
          submitted_at: string
          total_count: number
        }[]
      }
      reward_tier_bounds: {
        Args: {
          tier: Database["public"]["Tables"]["program_reward_tiers"]["Row"]
        }
        Returns: unknown
      }
      set_program_status_atomic: {
        Args: {
          actor_id: string
          next_status: string
          target_program_id: string
        }
        Returns: string
      }
      set_researcher_payout_wallet: {
        Args: {
          actor_id: string
          confirm_active_reward_change: boolean
          new_wallet_address: string
        }
        Returns: {
          has_active_rewards: boolean
          wallet_address: string
          wallet_updated_at: string
        }[]
      }
      start_report_payment_atomic: {
        Args: {
          actor_id: string
          payment_token_address: string
          payment_transaction_hash: string
          target_report_id: string
        }
        Returns: string
      }
      storage_program_id: { Args: { object_name: string }; Returns: string }
      storage_report_id: { Args: { object_name: string }; Returns: string }
      store_funding_sync_transaction_atomic: {
        Args: {
          circle_transaction_id: string
          requested_lease_id: string
          target_intent_id: string
        }
        Returns: boolean
      }
      submit_report_atomic: {
        Args: {
          actor_id: string
          generated_content_hash: string
          input: Json
          target_program_id: string
        }
        Returns: string
      }
      update_profile_display_name_atomic: {
        Args: { actor_id: string; new_display_name: string }
        Returns: string
      }
      update_program_atomic: {
        Args: { actor_id: string; input: Json; target_program_id: string }
        Returns: string
      }
      update_report_atomic: {
        Args: {
          actor_id: string
          generated_content_hash: string
          input: Json
          resubmit: boolean
          target_report_id: string
        }
        Returns: string
      }
      validate_report_atomic: {
        Args: {
          actor_id: string
          selected_severity: string
          target_report_id: string
        }
        Returns: string
      }
      write_program_children: {
        Args: { input: Json; target_program_id: string }
        Returns: undefined
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
  public: {
    Enums: {},
  },
} as const
