import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ApiResponse,
  BottleneckData,
  EvidenceItem,
  LoginResponse,
  Policy,
  Summary,
  Task,
  TaskFormFillSuggestion,
  Tramite,
  User,
  WorkflowSuggestion
} from './api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly fileBaseUrl = '';
  private readonly baseUrl = '/api';

  // ----- Auth -----
  login(payload: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/auth/login`, payload);
  }

  // ----- Users -----
  listUsers(): Observable<ApiResponse<User[]>> {
    return this.http.get<ApiResponse<User[]>>(`${this.baseUrl}/users`);
  }

  createUser(payload: Partial<User> & { password: string }): Observable<ApiResponse<User>> {
    return this.http.post<ApiResponse<User>>(`${this.baseUrl}/users`, payload);
  }

  updateUser(userId: string, payload: Partial<User> & { password?: string | null }): Observable<ApiResponse<User>> {
    return this.http.put<ApiResponse<User>>(`${this.baseUrl}/users/${userId}`, payload);
  }

  updateUserPlan(userId: string, subscriptionPlan: string): Observable<ApiResponse<User>> {
    return this.http.put<ApiResponse<User>>(`${this.baseUrl}/users/${userId}/plan`, {
      subscription_plan: subscriptionPlan
    });
  }

  // ----- Policies -----
  listPolicies(): Observable<ApiResponse<Policy[]>> {
    return this.http.get<ApiResponse<Policy[]>>(`${this.baseUrl}/policies`);
  }

  getPolicy(policyId: string): Observable<ApiResponse<Policy>> {
    return this.http.get<ApiResponse<Policy>>(`${this.baseUrl}/policies/${policyId}`);
  }

  createPolicy(payload: { name: string; description: string; procedure_type: string }): Observable<ApiResponse<Policy>> {
    return this.http.post<ApiResponse<Policy>>(`${this.baseUrl}/policies`, payload);
  }

  addPolicyNode(
    policyId: string,
    payload: {
      code: string;
      name: string;
      node_type: string;
      lane: string;
      responsible_role?: string | null;
      responsible_department?: string | null;
      form_fields?: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
    }
  ): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/policies/${policyId}/nodes`, payload);
  }

  updatePolicyNode(
    policyId: string,
    nodeCode: string,
    payload: {
      name?: string;
      node_type?: string;
      lane?: string;
      responsible_role?: string | null;
      responsible_department?: string | null;
      form_fields?: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
    }
  ): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(`${this.baseUrl}/policies/${policyId}/nodes/${nodeCode}`, payload);
  }

  deletePolicyNode(policyId: string, nodeCode: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.baseUrl}/policies/${policyId}/nodes/${nodeCode}`);
  }

  addPolicyTransition(
    policyId: string,
    payload: { source_code: string; target_code: string; condition_label?: string | null; transition_type: string }
  ): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/policies/${policyId}/transitions`, payload);
  }

  deletePolicyTransition(policyId: string, transitionId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.baseUrl}/policies/${policyId}/transitions/${transitionId}`);
  }

  validatePolicy(policyId: string): Observable<ApiResponse<{ valid: boolean; observations: string[] }>> {
    return this.http.post<ApiResponse<{ valid: boolean; observations: string[] }>>(
      `${this.baseUrl}/policies/${policyId}/validate`,
      {}
    );
  }

  publishPolicy(policyId: string): Observable<ApiResponse<{ policy_id: string; status: string }>> {
    return this.http.post<ApiResponse<{ policy_id: string; status: string }>>(
      `${this.baseUrl}/policies/${policyId}/publish`,
      {}
    );
  }

  generateWorkflowSuggestion(payload: {
    prompt: string;
    policy_name?: string | null;
    procedure_type?: string | null;
    policy_description?: string | null;
  }): Observable<ApiResponse<WorkflowSuggestion>> {
    return this.http.post<ApiResponse<WorkflowSuggestion>>(`${this.baseUrl}/ai/workflow-suggestion`, payload);
  }

  transcribeAudio(payload: { audio_base64: string; mime_type: string }): Observable<{ transcript: string; source: string }> {
    return this.http.post<{ transcript: string; source: string }>(`${this.baseUrl}/ai/transcribe-audio`, payload);
  }

  generateWorkflowSuggestionFromAudio(payload: {
    audio_base64: string;
    mime_type: string;
    policy_name?: string | null;
    procedure_type?: string | null;
    policy_description?: string | null;
  }): Observable<ApiResponse<WorkflowSuggestion>> {
    return this.http.post<ApiResponse<WorkflowSuggestion>>(`${this.baseUrl}/ai/workflow-suggestion-audio`, payload);
  }

  generateTaskFormFill(payload: {
    report_text: string;
    task_title?: string | null;
    node_name?: string | null;
    lane?: string | null;
    procedure_type?: string | null;
    applicant_name?: string | null;
    applicant_document?: string | null;
    fields: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
  }): Observable<ApiResponse<TaskFormFillSuggestion>> {
    return this.http.post<ApiResponse<TaskFormFillSuggestion>>(`${this.baseUrl}/ai/task-form-fill`, payload);
  }

  generateTaskFormFillLocal(payload: {
    report_text: string;
    task_title?: string | null;
    node_name?: string | null;
    lane?: string | null;
    procedure_type?: string | null;
    applicant_name?: string | null;
    applicant_document?: string | null;
    fields: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
  }): Observable<ApiResponse<TaskFormFillSuggestion>> {
    return this.http.post<ApiResponse<TaskFormFillSuggestion>>(`${this.baseUrl}/ai/task-form-fill-local`, payload);
  }

  generateTaskFormFillFromAudio(payload: {
    audio_base64: string;
    mime_type: string;
    task_title?: string | null;
    node_name?: string | null;
    lane?: string | null;
    procedure_type?: string | null;
    applicant_name?: string | null;
    applicant_document?: string | null;
    fields: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
  }): Observable<ApiResponse<TaskFormFillSuggestion>> {
    return this.http.post<ApiResponse<TaskFormFillSuggestion>>(`${this.baseUrl}/ai/task-form-fill-audio`, payload);
  }

  // ----- Tramites -----
  listTramites(): Observable<ApiResponse<Tramite[]>> {
    return this.http.get<ApiResponse<Tramite[]>>(`${this.baseUrl}/tramites`);
  }

  getTramite(code: string): Observable<ApiResponse<Tramite>> {
    return this.http.get<ApiResponse<Tramite>>(`${this.baseUrl}/tramites/${code}`);
  }

  createTramite(payload: {
    applicant_name: string;
    applicant_document: string;
    procedure_type: string;
  }): Observable<ApiResponse<Tramite>> {
    return this.http.post<ApiResponse<Tramite>>(`${this.baseUrl}/tramites`, payload);
  }

  getTramiteTasks(tramiteCode: string): Observable<ApiResponse<Task[]>> {
    return this.http.get<ApiResponse<Task[]>>(`${this.baseUrl}/tramites/${tramiteCode}/tasks`);
  }

  // ----- Tasks -----
  listTasks(): Observable<ApiResponse<Task[]>> {
    return this.http.get<ApiResponse<Task[]>>(`${this.baseUrl}/tasks`);
  }

  getTask(taskId: string): Observable<ApiResponse<Task>> {
    return this.http.get<ApiResponse<Task>>(`${this.baseUrl}/tasks/${taskId}`);
  }

  updateTask(taskId: string, payload: Partial<Task>): Observable<ApiResponse<Task>> {
    return this.http.put<ApiResponse<Task>>(`${this.baseUrl}/tasks/${taskId}`, payload);
  }

  completeTask(taskId: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/tasks/${taskId}/complete`, {});
  }

  uploadTaskEvidence(
    taskId: string,
    payload: { file_name: string; file_base64: string; content_type?: string | null; note?: string }
  ): Observable<ApiResponse<EvidenceItem>> {
    return this.http.post<ApiResponse<EvidenceItem>>(`${this.baseUrl}/tasks/${taskId}/evidences`, payload);
  }

  // ----- Analytics -----
  getSummary(): Observable<ApiResponse<Summary>> {
    return this.http.get<ApiResponse<Summary>>(`${this.baseUrl}/analytics/summary`);
  }

  getBottlenecks(): Observable<ApiResponse<BottleneckData>> {
    return this.http.get<ApiResponse<BottleneckData>>(`${this.baseUrl}/analytics/bottlenecks`);
  }

  exportAnalyticsReport(format: 'json' | 'csv') {
    return this.http.get(`${this.baseUrl}/analytics/report?format=${format}`, {
      responseType: 'blob'
    });
  }
}
