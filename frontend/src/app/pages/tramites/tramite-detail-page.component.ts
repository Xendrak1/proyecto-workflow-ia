import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { AuditLog, DocumentRecord, Policy, Task, Tramite } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface TimelineStep {
  code: string;
  name: string;
  lane: string;
  task: Task | null;
  status: 'completed' | 'current' | 'pending';
}

@Component({
  selector: 'app-tramite-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './tramite-detail-page.component.html',
  styleUrl: './tramite-detail-page.component.scss'
})
export class TramiteDetailPageComponent implements OnInit {
  @Input() tramiteCode = '';

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  readonly tramite = signal<Tramite | null>(null);
  readonly tasks = signal<Task[]>([]);
  readonly policy = signal<Policy | null>(null);
  readonly documents = signal<DocumentRecord[]>([]);
  readonly auditLogs = signal<AuditLog[]>([]);
  readonly loading = signal(true);
  readonly uploadingDocument = signal(false);
  readonly versioningDocumentId = signal<string | null>(null);
  documentTitle = '';
  documentDescription = '';
  selectedDocumentFile: File | null = null;

  readonly timeline = computed<TimelineStep[]>(() => {
    const policy = this.policy();
    const tramite = this.tramite();
    if (!policy || !tramite) return [];

    const sortedNodes = [...(policy.nodes ?? [])];
    const tasksByNode = new Map<string, Task>();
    for (const task of this.tasks()) {
      tasksByNode.set(task.node_code, task);
    }

    const currentCode = tramite.current_node_code;
    return sortedNodes.map((node) => {
      const task = tasksByNode.get(node.code) ?? null;
      let status: TimelineStep['status'] = 'pending';
      if (task?.status === 'completada') status = 'completed';
      else if (node.code === currentCode || task?.status === 'en_proceso') status = 'current';
      else if (!task && currentCode) {
        const order = sortedNodes.findIndex((n) => n.code === node.code);
        const currentOrder = sortedNodes.findIndex((n) => n.code === currentCode);
        if (currentOrder > -1 && order < currentOrder) status = 'completed';
      }
      return {
        code: node.code,
        name: node.name,
        lane: node.lane,
        task,
        status
      };
    });
  });

  readonly progress = computed(() => {
    const items = this.timeline();
    if (!items.length) return 0;
    const done = items.filter((step) => step.status === 'completed').length;
    return Math.round((done / items.length) * 100);
  });

  ngOnInit(): void {
    if (this.tramiteCode) void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const tramiteResponse = await firstValueFrom(this.api.getTramite(this.tramiteCode));
      this.tramite.set(tramiteResponse.data);
      const [tasks, policies] = await Promise.all([
        firstValueFrom(this.api.getTramiteTasks(this.tramiteCode)),
        firstValueFrom(this.api.listPolicies())
      ]);
      this.tasks.set(tasks.data ?? []);
      const policy =
        policies.data.find((p) => p._id === tramiteResponse.data.policy_id) ?? null;
      this.policy.set(policy);
      await this.loadDocumentsAndAudit(tramiteResponse.data);
    } catch {
      this.toast.error('No se pudo cargar el trámite');
    } finally {
      this.loading.set(false);
    }
  }

  async loadDocumentsAndAudit(tramite: Tramite): Promise<void> {
    const [documents, audit] = await Promise.allSettled([
      firstValueFrom(this.api.listDocuments({ tramite_code: tramite.code })),
      firstValueFrom(this.api.listAuditLogs({ tramite_code: tramite.code }))
    ]);
    if (documents.status === 'fulfilled') this.documents.set(documents.value.data ?? []);
    if (audit.status === 'fulfilled') this.auditLogs.set(audit.value.data ?? []);
  }

  back(): void {
    this.router.navigateByUrl('/app/tramites');
  }

  openTask(task: Task | null): void {
    if (!task?._id) return;
    this.router.navigate(['/app/inbox', task._id]);
  }

  onDocumentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedDocumentFile = input.files?.[0] ?? null;
    if (this.selectedDocumentFile && !this.documentTitle.trim()) {
      this.documentTitle = this.selectedDocumentFile.name.replace(/\.[^.]+$/, '');
    }
  }

  async uploadDocument(): Promise<void> {
    const tramite = this.tramite();
    if (!tramite || !this.selectedDocumentFile || !this.documentTitle.trim()) {
      this.toast.warn('Selecciona un archivo y título');
      return;
    }
    this.uploadingDocument.set(true);
    try {
      const fileBase64 = await this.fileToBase64(this.selectedDocumentFile);
      await firstValueFrom(
        this.api.createDocument({
          policy_id: tramite.policy_id,
          tramite_code: tramite.code,
          title: this.documentTitle.trim(),
          description: this.documentDescription.trim() || null,
          document_type: 'other',
          properties: {
            applicant_name: tramite.applicant_name,
            applicant_document: tramite.applicant_document,
            procedure_type: tramite.procedure_type
          },
          permissions: [
            { subject_type: 'role', subject: 'administrador', can_view: true, can_upload: true, can_version: true, can_delete: true },
            { subject_type: 'role', subject: 'supervisor', can_view: true, can_upload: true, can_version: true, can_delete: false },
            { subject_type: 'department', subject: 'Atencion al Cliente', can_view: true, can_upload: true, can_version: true, can_delete: false }
          ],
          file_name: this.selectedDocumentFile.name,
          file_base64: fileBase64,
          content_type: this.selectedDocumentFile.type || null,
          change_summary: 'Carga inicial desde repositorio del tramite',
          actor_name: this.session.fullName() || this.session.email()
        })
      );
      this.toast.success('Documento cargado');
      this.documentTitle = '';
      this.documentDescription = '';
      this.selectedDocumentFile = null;
      await this.loadDocumentsAndAudit(tramite);
    } catch {
      this.toast.error('No se pudo cargar el documento');
    } finally {
      this.uploadingDocument.set(false);
    }
  }

  async uploadNewVersion(document: DocumentRecord, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.versioningDocumentId.set(document._id);
    try {
      const fileBase64 = await this.fileToBase64(file);
      await firstValueFrom(
        this.api.createDocumentVersion(document._id, {
          file_name: file.name,
          file_base64: fileBase64,
          content_type: file.type || null,
          change_summary: `Version nueva subida desde ${file.name}`,
          actor_name: this.session.fullName() || this.session.email()
        })
      );
      this.toast.success('Versión registrada');
      if (this.tramite()) await this.loadDocumentsAndAudit(this.tramite()!);
    } catch {
      this.toast.error('No se pudo registrar la versión');
    } finally {
      this.versioningDocumentId.set(null);
      input.value = '';
    }
  }

  currentVersion(document: DocumentRecord) {
    return document.versions.find((version) => version.version_number === document.current_version) ?? document.versions.at(-1) ?? null;
  }

  fileUrl(document: DocumentRecord): string | null {
    return this.currentVersion(document)?.file_url ?? null;
  }

  badgeForStatus(status: string): string {
    const map: Record<string, string> = {
      registrado: 'neutral',
      en_proceso: 'info',
      completado: 'success',
      observado: 'warn',
      rechazado: 'danger'
    };
    return map[status] ?? 'neutral';
  }

  badgeForTask(status: string | undefined): string {
    if (!status) return 'neutral';
    const map: Record<string, string> = {
      pendiente: 'neutral',
      en_proceso: 'info',
      observada: 'warn',
      completada: 'success'
    };
    return map[status] ?? 'neutral';
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleString('es-BO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatBytes(value: number | null | undefined): string {
    if (!value) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
