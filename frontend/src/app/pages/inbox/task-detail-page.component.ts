import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { EvidenceItem, Policy, PolicyNode, Task, TaskFormFillSuggestion, Tramite } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

interface DynamicField {
  key: string;
  label: string;
  field_type: string;
  required: boolean;
  options: string[];
}

@Component({
  selector: 'app-task-detail-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './task-detail-page.component.html',
  styleUrl: './task-detail-page.component.scss'
})
export class TaskDetailPageComponent implements OnInit, OnDestroy {
  @Input() taskId = '';

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly session = inject(SessionService);

  readonly task = signal<Task | null>(null);
  readonly tramite = signal<Tramite | null>(null);
  readonly policy = signal<Policy | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly observation = signal('');
  readonly aiStatus = signal('Describe el informe o graba audio para que la IA complete el formulario.');
  readonly aiError = signal<string | null>(null);
  readonly aiLoading = signal(false);
  readonly aiListening = signal(false);
  readonly aiRecording = signal(false);
  readonly aiLiveTranscript = signal('');
  readonly aiSuggestion = signal<TaskFormFillSuggestion | null>(null);
  readonly uploadingEvidence = signal(false);
  readonly selectedEvidenceName = signal('');
  readonly evidenceNote = signal('');
  readonly selectedAudioName = signal('');
  readonly voiceSupported = signal(this.detectVoiceSupport());
  readonly recordingSupported = signal(typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined');
  readonly canUseVoice = computed(() => this.voiceSupported() || this.recordingSupported());

  readonly dynamicForm = signal<FormGroup>(this.fb.group({}));
  readonly fields = signal<DynamicField[]>([]);
  readonly aiForm = this.fb.group({
    report_text: ['', Validators.required]
  });

  readonly currentNode = computed<PolicyNode | null>(() => {
    const policy = this.policy();
    const task = this.task();
    if (!policy || !task) return null;
    return policy.nodes.find((node) => node.code === task.node_code) ?? null;
  });

  private mediaRecorder: MediaRecorder | null = null;
  private speechRecognition:
    | {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        maxAlternatives: number;
        start(): void;
        stop(): void;
        onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
        onerror: ((event: { error: string }) => void) | null;
        onend: (() => void) | null;
      }
    | null = null;
  private audioChunks: Blob[] = [];
  private selectedEvidenceFile: File | null = null;
  private selectedAudioFile: File | null = null;
  private readonly fileBaseUrl = this.api.fileBaseUrl;
  private speechBaseText = '';
  private speechFinalText = '';

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.speechRecognition?.stop();
    this.mediaRecorder?.stream?.getTracks().forEach((track) => track.stop());
  }

  private async loadAll(): Promise<void> {
    if (!this.taskId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const taskRes = await firstValueFrom(this.api.getTask(this.taskId));
      const task = taskRes.data;
      this.task.set(task);
      this.observation.set(task.observations ?? '');

      const [tramiteRes, policyRes] = await Promise.all([
        firstValueFrom(this.api.getTramite(task.tramite_id)),
        firstValueFrom(this.api.getPolicy(task.policy_id))
      ]);
      this.tramite.set(tramiteRes.data);
      this.policy.set(policyRes.data);

      const node = policyRes.data.nodes.find((n) => n.code === task.node_code);
      const fields: DynamicField[] = (node?.form_fields ?? []).map((field) => ({
        key: field.key,
        label: field.label,
        field_type: field.field_type,
        required: !!field.required,
        options: field.options ?? []
      }));
      this.fields.set(fields);
      this.dynamicForm.set(this.buildFormGroup(fields, task.form_data ?? {}));
    } catch (err) {
      this.toast.error('No se pudo cargar la tarea');
    } finally {
      this.loading.set(false);
    }
  }

  private buildFormGroup(fields: DynamicField[], existing: Record<string, unknown>): FormGroup {
    const controls: Record<string, unknown> = {};
    for (const field of fields) {
      const value = existing[field.key] ?? (field.field_type === 'booleano' ? false : '');
      controls[field.key] = field.required
        ? this.fb.control(value, Validators.required)
        : this.fb.control(value);
    }
    return this.fb.group(controls);
  }

  private detectVoiceSupport(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  back(): void {
    this.router.navigateByUrl('/app/inbox');
  }

  canEditTask(): boolean {
    return this.session.hasPermission('task.edit');
  }

  canCompleteTask(): boolean {
    return this.session.hasPermission('task.complete');
  }

  canUploadEvidence(): boolean {
    return this.session.hasPermission('task.evidence');
  }

  async generateAiFill(): Promise<void> {
    const reportText = this.aiForm.getRawValue().report_text?.trim() ?? '';
    if (!reportText || !this.task() || !this.currentNode()) {
      this.aiForm.markAllAsTouched();
      return;
    }
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiSuggestion.set(null);
    this.aiStatus.set('Gemini está leyendo el informe y proponiendo el llenado del formulario...');
    try {
      const response = await firstValueFrom(
        this.api.generateTaskFormFill({
          report_text: reportText,
          ...this.buildAiTaskContext()
        })
      );
      this.aiSuggestion.set(response.data);
      this.aiStatus.set('La IA preparó una propuesta de llenado. Revísala y aplícala si te sirve.');
      this.aiError.set(this.describeAiSource(response.data.source));
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.aiError.set(message);
      this.aiStatus.set('No se pudo generar la propuesta de llenado con IA.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  async extractAiFillLocally(): Promise<void> {
    const reportText = this.aiForm.getRawValue().report_text?.trim() ?? '';
    if (!reportText || !this.task() || !this.currentNode()) {
      this.aiForm.markAllAsTouched();
      return;
    }
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiSuggestion.set(null);
    this.aiStatus.set('Extrayendo datos del texto actual sin usar Gemini...');
    try {
      const response = await firstValueFrom(
        this.api.generateTaskFormFillLocal({
          report_text: reportText,
          ...this.buildAiTaskContext()
        })
      );
      this.aiSuggestion.set(response.data);
      this.aiStatus.set('Se extrajo una propuesta directa desde el texto actual.');
      this.aiError.set(null);
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.aiError.set(message);
      this.aiStatus.set('No se pudo extraer información desde el texto actual.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  applyAiFill(): void {
    const suggestion = this.aiSuggestion();
    if (!suggestion) return;
    this.dynamicForm().patchValue(suggestion.form_data);
    if (suggestion.observations && !this.observation().trim() && !this.hasObservationLikeFieldValue(suggestion.form_data)) {
      this.observation.set(suggestion.observations);
    }
    if (suggestion.transcript) {
      this.aiForm.patchValue({ report_text: suggestion.transcript });
    }
    this.toast.success('Formulario completado', 'La propuesta de IA se aplicó sobre esta tarea.');
  }

  toggleVoice(): void {
    if (this.voiceSupported()) {
      this.toggleSpeechDictation();
      return;
    }
    if (this.recordingSupported()) {
      void this.toggleAudioRecording();
      return;
    }
    this.aiError.set('Este navegador no permite usar dictado ni grabación directa en esta pantalla. Puedes subir un audio grabado y la IA lo procesará igual.');
  }

  private toggleSpeechDictation(): void {
    if (this.aiListening() && this.speechRecognition) {
      this.aiStatus.set('Deteniendo dictado...');
      this.speechRecognition.stop();
      return;
    }

    const Ctor =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!Ctor) {
      this.aiError.set('Este navegador no expone el dictado en vivo. Puedes usar grabación de audio o subir un archivo.');
      return;
    }

    const recognition = new (Ctor as new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      maxAlternatives: number;
      start(): void;
      stop(): void;
      onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
    })();

    this.speechRecognition = recognition;
    this.speechBaseText = this.aiForm.getRawValue().report_text?.trim() ?? '';
    this.speechFinalText = '';
    this.aiLiveTranscript.set('');
    this.aiError.set(null);

    recognition.lang = 'es-BO';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index] as unknown as { 0?: { transcript?: string }; isFinal?: boolean };
        const transcript = result?.[0]?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (result.isFinal) {
          finalChunk += `${transcript} `;
        } else {
          interimChunk += `${transcript} `;
        }
      }

      this.speechFinalText = `${this.speechFinalText} ${finalChunk}`.trim();
      const finalized = `${this.speechBaseText} ${this.speechFinalText}`.trim();
      const live = `${finalized} ${interimChunk}`.trim();

      this.aiLiveTranscript.set(interimChunk.trim());
      this.aiForm.patchValue({ report_text: live || finalized || this.speechBaseText });
      this.aiStatus.set(interimChunk.trim() ? 'Escuchando y escribiendo en vivo...' : 'Voz capturada. Sigue hablando o detén el dictado cuando termines.');
    };

    recognition.onerror = (event) => {
      this.aiError.set(`No se pudo capturar voz: ${event.error}. Si quieres, usa grabación de audio o sube un archivo.`);
      this.aiListening.set(false);
      this.aiLiveTranscript.set('');
      this.speechRecognition = null;
    };

    recognition.onend = () => {
      const finalText = this.aiForm.getRawValue().report_text?.trim() ?? '';
      this.aiListening.set(false);
      this.aiLiveTranscript.set('');
      this.speechRecognition = null;
      this.aiStatus.set(
        finalText
          ? 'Dictado finalizado. Revisa el texto y, si está bien, genera el llenado.'
          : 'No se capturó texto útil. Puedes intentarlo otra vez o subir un audio.'
      );
    };

    this.aiListening.set(true);
    this.aiStatus.set('Escuchando y escribiendo en vivo...');
    recognition.start();
  }

  async saveProgress(): Promise<void> {
    const task = this.task();
    if (!task?._id) return;
    this.saving.set(true);
    try {
      const formValue = this.dynamicForm().getRawValue();
      await firstValueFrom(
        this.api.updateTask(task._id, {
          form_data: formValue,
          observations: this.observation() || undefined
        })
      );
      this.toast.success('Avance guardado', 'La tarea fue actualizada');
      await this.loadAll();
    } catch {
      this.toast.error('No se pudo guardar el avance');
    } finally {
      this.saving.set(false);
    }
  }

  onEvidencePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedEvidenceFile = file;
    this.selectedEvidenceName.set(file?.name ?? '');
  }

  updateEvidenceNote(event: Event): void {
    this.evidenceNote.set((event.target as HTMLInputElement).value);
  }

  async uploadEvidence(): Promise<void> {
    const task = this.task();
    const file = this.selectedEvidenceFile;
    if (!task?._id || !file) {
      this.toast.warn('Selecciona un archivo antes de cargar evidencia');
      return;
    }
    this.uploadingEvidence.set(true);
    try {
      const response = await firstValueFrom(
        this.api.uploadTaskEvidence(task._id, {
          file_name: file.name,
          file_base64: await this.blobToBase64(file),
          content_type: file.type || 'application/octet-stream',
          note: this.evidenceNote(),
        })
      );
      const evidence = response.data;
      this.task.update((current) =>
        current
          ? {
              ...current,
              evidences: [...(current.evidences ?? []), evidence],
            }
          : current
      );
      const fileField = this.fields().find((field) => field.field_type === 'archivo' || field.field_type === 'imagen');
      if (fileField && !this.dynamicForm().get(fileField.key)?.value) {
        this.dynamicForm().patchValue({ [fileField.key]: this.absoluteEvidenceUrl(evidence) });
      }
      this.selectedEvidenceFile = null;
      this.selectedEvidenceName.set('');
      this.evidenceNote.set('');
      this.toast.success('Evidencia cargada', 'El archivo ya está disponible en esta tarea.');
    } catch {
      this.toast.error('No se pudo cargar la evidencia');
    } finally {
      this.uploadingEvidence.set(false);
    }
  }

  async completeTask(): Promise<void> {
    const task = this.task();
    if (!task?._id) return;
    if (this.dynamicForm().invalid) {
      this.dynamicForm().markAllAsTouched();
      this.toast.warn('Completa los campos requeridos antes de cerrar la tarea');
      return;
    }
    this.saving.set(true);
    try {
      const formValue = this.dynamicForm().getRawValue();
      await firstValueFrom(
        this.api.updateTask(task._id, {
          form_data: formValue,
          observations: this.observation() || undefined
        })
      );
      const result = await firstValueFrom(this.api.completeTask(task._id));
      this.toast.success('Tarea completada', result.message);
      this.router.navigateByUrl('/app/inbox');
    } catch {
      this.toast.error('No se pudo completar la tarea');
    } finally {
      this.saving.set(false);
    }
  }

  private async toggleAudioRecording(): Promise<void> {
    if (this.aiRecording()) {
      this.mediaRecorder?.stop();
      this.aiRecording.set(false);
      this.aiListening.set(false);
      this.aiStatus.set('Procesando audio grabado...');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.aiError.set('Tu navegador no permite usar el micrófono en esta página. Sube un archivo de audio como alternativa.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };
      recorder.onstop = () => {
        void this.processRecordedAudio('audio/webm');
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      this.aiRecording.set(true);
      this.aiListening.set(true);
      this.aiError.set(null);
      this.aiStatus.set('Grabando audio para llenar el formulario con IA...');
    } catch {
      this.aiError.set('No se pudo acceder al micrófono. Prueba con un archivo de audio.');
    }
  }

  onAudioPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedAudioFile = file;
    this.selectedAudioName.set(file?.name ?? '');
    if (file) {
      this.aiError.set(null);
      this.aiStatus.set('Audio cargado. Ahora puedes enviarlo a la IA.');
    }
  }

  async submitAudioFile(): Promise<void> {
    const file = this.selectedAudioFile;
    if (!file) {
      this.aiError.set('Selecciona un archivo de audio antes de enviarlo.');
      return;
    }
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiStatus.set('Transcribiendo el archivo de audio...');
    try {
      const response = await firstValueFrom(
        this.api.transcribeAudio({
          audio_base64: await this.blobToBase64(file),
          mime_type: file.type || 'audio/webm',
        })
      );
      this.aiForm.patchValue({ report_text: response.transcript });
      this.aiLiveTranscript.set('');
      this.aiStatus.set('Transcripción lista. Revisa el texto y usa "Generar" o "Extraer del texto" para completar el formulario.');
      this.aiError.set(null);
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.aiError.set(message);
      this.aiStatus.set('No se pudo transcribir el archivo de audio.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  private async processRecordedAudio(mimeType: string): Promise<void> {
    const blob = new Blob(this.audioChunks, { type: mimeType });
    if (!blob.size) {
      this.aiError.set('No se capturó audio útil.');
      return;
    }
    this.aiLoading.set(true);
    this.aiError.set(null);
    this.aiStatus.set('Transcribiendo audio con Vosk...');
    try {
      const response = await firstValueFrom(
        this.api.transcribeAudio({
          audio_base64: await this.blobToBase64(blob),
          mime_type: mimeType,
        })
      );
      this.aiForm.patchValue({ report_text: response.transcript });
      this.aiLiveTranscript.set('');
      this.aiStatus.set('Transcripción lista. Revisa el texto y usa "Generar" o "Extraer del texto" para completar el formulario.');
      this.aiError.set(null);
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.aiError.set(message);
      this.aiStatus.set('No se pudo transcribir el audio.');
    } finally {
      this.aiLoading.set(false);
      this.aiRecording.set(false);
      this.aiListening.set(false);
      this.audioChunks = [];
    }
  }

  private buildAiTaskContext(): {
    task_title?: string | null;
    node_name?: string | null;
    lane?: string | null;
    procedure_type?: string | null;
    applicant_name?: string | null;
    applicant_document?: string | null;
    fields: Array<{ key: string; label: string; field_type: string; required: boolean; options: string[] }>;
  } {
    return {
      task_title: this.task()?.title ?? null,
      node_name: this.currentNode()?.name ?? null,
      lane: this.currentNode()?.lane ?? null,
      procedure_type: this.tramite()?.procedure_type ?? null,
      applicant_name: this.tramite()?.applicant_name ?? null,
      applicant_document: this.tramite()?.applicant_document ?? null,
      fields: this.fields().map((field) => ({
        key: field.key,
        label: field.label,
        field_type: field.field_type,
        required: field.required,
        options: field.options
      }))
    };
  }

  absoluteEvidenceUrl(evidence: EvidenceItem): string {
    if (!evidence.file_url) return '';
    return evidence.file_url.startsWith('http') ? evidence.file_url : `${this.fileBaseUrl}${evidence.file_url}`;
  }

  formatBytes(value?: number | null): string {
    if (!value) return 'Sin tamaño';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('No se pudo leer el audio.'));
          return;
        }
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el audio.'));
      reader.readAsDataURL(blob);
    });
  }

  statusBadge(status: string | undefined): string {
    if (!status) return 'neutral';
    const map: Record<string, string> = {
      pendiente: 'danger',
      en_proceso: 'warn',
      observada: 'violet',
      completada: 'success',
      vencida: 'danger',
      registrado: 'info',
      rechazado: 'danger'
    };
    return map[status] ?? 'neutral';
  }

  updateObservation(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.observation.set(value);
  }

  private hasObservationLikeFieldValue(formData: Record<string, unknown>): boolean {
    const observationLikeTokens = ['observ', 'descripcion', 'descripción', 'detalle', 'comentario', 'nota'];
    return this.fields().some((field) => {
      const searchText = `${field.key} ${field.label}`.toLowerCase();
      if (!observationLikeTokens.some((token) => searchText.includes(token))) {
        return false;
      }
      const value = formData[field.key];
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return value !== null && value !== undefined && value !== false;
    });
  }

  private describeAiSource(source?: string | null): string | null {
    if (!source) return null;
    if (source.startsWith('fallback-quota')) {
      return 'Gemini alcanzó su cuota temporal. El sistema armó una propuesta local con los datos que pudo inferir.';
    }
    if (source.startsWith('fallback')) {
      return 'Gemini no devolvió una estructura perfecta y se usó una propuesta base revisable.';
    }
    return null;
  }
}
