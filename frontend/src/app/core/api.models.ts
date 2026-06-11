import type { PermissionKey } from './session.service';

export interface ApiResponse<T> {
  message: string;
  data: T;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  email: string;
  full_name: string;
  subscription_plan: string;
  user_id: string;
  department: string | null;
  permissions?: PermissionKey[];
}

export interface User {
  _id?: string;
  full_name: string;
  email: string;
  role: string;
  department?: string | null;
  status?: string;
  subscription_plan?: string;
  permissions?: PermissionKey[];
}

export interface Policy {
  _id: string;
  name: string;
  description: string;
  procedure_type: string;
  version: number;
  status: string;
  nodes: PolicyNode[];
  transitions: PolicyTransition[];
}

export interface PolicyNode {
  _id?: string;
  code: string;
  name: string;
  node_type: string;
  lane: string;
  responsible_role?: string | null;
  responsible_department?: string | null;
  form_fields?: Array<{
    key: string;
    label: string;
    field_type: string;
    required: boolean;
    options: string[];
  }>;
}

export interface PolicyTransition {
  _id?: string;
  source_code: string;
  target_code: string;
  condition_label?: string | null;
  transition_type: string;
}

export interface WorkflowSuggestion {
  source?: string;
  model?: string | null;
  transcript?: string | null;
  title: string;
  summary: string;
  nodes: Array<{
    code: string;
    name: string;
    node_type: string;
    lane: string;
    responsible_role?: string | null;
    responsible_department?: string | null;
    form_fields?: Array<{
      key: string;
      label: string;
      field_type: string;
      required: boolean;
      options: string[];
    }>;
  }>;
  transitions: Array<{
    source_code: string;
    target_code: string;
    transition_type: string;
    condition_label?: string | null;
  }>;
}

export interface TaskFormFillSuggestion {
  source?: string;
  model?: string | null;
  transcript?: string | null;
  summary: string;
  observations?: string | null;
  form_data: Record<string, unknown>;
}

export interface EvidenceItem {
  _id?: string | null;
  file_name: string;
  file_url?: string | null;
  note?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
}

export interface Tramite {
  _id: string;
  code: string;
  applicant_name: string;
  applicant_document: string;
  procedure_type: string;
  policy_id: string;
  policy_version: number;
  status: string;
  current_node_code?: string | null;
  history: unknown[];
}

export interface Task {
  _id: string;
  tramite_id: string;
  policy_id: string;
  node_code: string;
  title: string;
  assigned_role?: string | null;
  assigned_department?: string | null;
  assigned_user_id?: string | null;
  status: string;
  form_data: Record<string, unknown>;
  evidences: EvidenceItem[];
  observations?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface Summary {
  total_tramites: number;
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
}

export interface BottleneckData {
  critical_nodes: Array<{ _id: string; total: number; pending: number; observed: number }>;
  recommendations: string[];
  ai_summary?: string;
  ai_source?: string;
}

export interface DocumentPermission {
  subject_type: 'role' | 'department' | 'user';
  subject: string;
  can_view: boolean;
  can_upload: boolean;
  can_version: boolean;
  can_delete: boolean;
}

export interface DocumentVersion {
  _id?: string | null;
  version_number: number;
  file_name: string;
  file_url?: string | null;
  content_type?: string | null;
  size_bytes: number;
  checksum_sha256: string;
  storage_provider: 'local' | 's3';
  storage_bucket?: string | null;
  storage_key: string;
  change_summary?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface DocumentRecord {
  _id: string;
  policy_id: string;
  tramite_code?: string | null;
  task_id?: string | null;
  node_code?: string | null;
  title: string;
  document_type: string;
  description?: string | null;
  properties: Record<string, unknown>;
  permissions: DocumentPermission[];
  current_version: number;
  versions: DocumentVersion[];
  created_at?: string;
  updated_at?: string;
}

export interface AuditLog {
  _id: string;
  action: string;
  actor_name?: string | null;
  policy_id?: string | null;
  tramite_code?: string | null;
  task_id?: string | null;
  document_id?: string | null;
  version_number?: number | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface RoutingIntelligence {
  model_type: string;
  total_tramites: number;
  total_tasks: number;
  risk_nodes: Array<{
    node_code: string;
    pending: number;
    observed: number;
    max_age_hours: number;
    meta?: { name: string; lane: string; policy: string } | null;
  }>;
  priority_recommendations: Array<{
    task_id: string;
    tramite_id: string;
    node_code: string;
    title: string;
    risk_score: number;
    risk_level: string;
    recommended_action: string;
  }>;
  anomalies: Array<{ kind: string; task_id: string; node_code: string; detail: string }>;
  best_route_recommendation: Array<{ node_code: string; node_name: string; lane: string; reason: string }>;
}

export interface IntelligentReport {
  title: string;
  summary: string;
  query_plan: string[];
  recommendations: string[];
  filters_detected: Record<string, unknown>;
  source: string;
  model_type: string;
  date_from?: string | null;
  date_to?: string | null;
  snapshot: RoutingIntelligence;
}
