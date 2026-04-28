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
