import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, Input, NgZone, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api.service';
import { Policy, PolicyNode, PolicyTransition, WorkflowSuggestion } from '../../core/api.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

type PanelKey = 'inspector' | 'add-node' | 'add-route' | 'fields' | 'ai';
type AIStrategy = 'merge' | 'adapt' | 'replace';
type TourTarget = 'designer-head' | 'designer-banner' | 'designer-meters' | 'designer-canvas' | 'designer-rail';

interface DiagramNodeView {
  code: string;
  name: string;
  node_type: string;
  lane: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DiagramEdgeView {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  labelX: number;
  labelY: number;
  label: string | null;
  type: string;
}

interface NodeLayoutEntry {
  x: number;
  y: number;
  lane: string;
}

interface AIHistoryItem {
  id: string;
  mode: 'text' | 'voice';
  status: 'success' | 'error' | 'fallback';
  title: string;
  detail: string;
  at: string;
}

interface LaneView {
  lane: string;
  items: PolicyNode[];
}

interface PanelGuide {
  title: string;
  description: string;
}

interface PageTourStep {
  target: TourTarget;
  title: string;
  body: string;
}

interface TourBubblePosition {
  top: number;
  left: number;
}

@Component({
  selector: 'app-policy-designer-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './policy-designer-page.component.html',
  styleUrl: './policy-designer-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PolicyDesignerPageComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly laneRowHeight = 160;
  private readonly defaultNodeSize = { width: 200, height: 88 };
  private readonly umlNodeSizes: Record<string, { width: number; height: number }> = {
    inicio: { width: 72, height: 72 },
    fin: { width: 76, height: 76 },
    decision: { width: 132, height: 112 },
    fork: { width: 168, height: 46 },
    join: { width: 168, height: 46 },
  };

  @Input() policyId = '';
  @ViewChild('laneControls') laneControlsRef?: ElementRef<HTMLElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly zone = inject(NgZone);

  readonly policy = signal<Policy | null>(null);
  readonly loading = signal(true);
  readonly selectedNodeCode = signal<string | null>(null);
  readonly panel = signal<PanelKey>('inspector');
  readonly nodeLayout = signal<Record<string, NodeLayoutEntry>>({});
  readonly zoomLevel = signal(1);
  readonly canvasOffset = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly laneTopPadding = signal(56);

  readonly aiSuggestion = signal<WorkflowSuggestion | null>(null);
  readonly aiStatus = signal('Describe el flujo en lenguaje natural y la IA propondrá los nodos.');
  readonly aiListening = signal(false);
  readonly aiLiveTranscript = signal('');
  readonly aiGenerating = signal(false);
  readonly aiErrorDetail = signal<string | null>(null);
  readonly aiHistory = signal<AIHistoryItem[]>([]);
  readonly voiceSupported = signal(this.detectVoiceSupport());
  readonly recordingSupported = signal(typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined');
  readonly aiRecording = signal(false);
  readonly canUseVoice = computed(() => this.voiceSupported() || this.recordingSupported());
  readonly organizing = signal(false);
  readonly editingLane = signal<string | null>(null);
  readonly laneDraft = signal('');
  readonly aiStrategy = signal<AIStrategy>('adapt');
  readonly creatingLane = signal(false);
  readonly newLaneName = signal('');
  readonly laneListCollapsed = signal(false);
  readonly tourOpen = signal(false);
  readonly tourIndex = signal(0);
  readonly tourBubble = signal<TourBubblePosition>({ top: 120, left: 120 });

  private resizeTourHandler: (() => void) | null = null;
  private readonly tourSteps: PageTourStep[] = [
    {
      target: 'designer-head',
      title: 'Estado y publicación',
      body: 'Aquí ves si la política sigue en borrador, la validas y la publicas cuando el flujo ya está listo para operar.'
    },
    {
      target: 'designer-banner',
      title: 'Ruta de trabajo',
      body: 'Este bloque resume el orden natural: agregar nodos, conectarlos, definir campos y luego validar o publicar.'
    },
    {
      target: 'designer-meters',
      title: 'Resumen del diagrama',
      body: 'Estas métricas te dicen cuántos nodos, decisiones, transiciones y calles tiene el proceso actual.'
    },
    {
      target: 'designer-canvas',
      title: 'Canvas visual',
      body: 'Aquí vive el diagrama. Puedes mover nodos, reorganizar el flujo y revisar cómo se conectan las calles.'
    },
    {
      target: 'designer-rail',
      title: 'Panel de edición',
      body: 'En este panel cambias entre Inspector, Nodo, Ruta, Campos e IA para editar el flujo paso a paso.'
    }
  ];

  readonly nodeForm = this.fb.group({
    code: ['', Validators.required],
    name: ['', Validators.required],
    node_type: ['actividad', Validators.required],
    lane: ['Atención al cliente', Validators.required],
    responsible_role: ['funcionario'],
    responsible_department: ['Atención al cliente']
  });

  readonly transitionForm = this.fb.group({
    source_code: ['', Validators.required],
    target_code: ['', Validators.required],
    condition_label: [''],
    transition_type: ['secuencial', Validators.required]
  });

  readonly fieldForm = this.fb.group({
    key: ['', Validators.required],
    label: ['', Validators.required],
    field_type: ['texto', Validators.required],
    required: [false],
    options_text: ['']
  });

  readonly aiForm = this.fb.group({
    prompt: [
      'Inicio -> Atención al cliente -> Revisión técnica -> Revisión legal -> Instalación -> Fin',
      Validators.required
    ]
  });

  // Computed
  readonly nodes = computed(() => this.policy()?.nodes ?? []);
  readonly transitions = computed(() => this.policy()?.transitions ?? []);
  readonly nodeOptions = computed(() =>
    this.nodes().map((node) => ({ code: node.code, name: node.name }))
  );

  readonly selectedNode = computed<PolicyNode | null>(() => {
    const code = this.selectedNodeCode();
    return this.nodes().find((node) => node.code === code) ?? null;
  });

  readonly outgoing = computed<PolicyTransition[]>(() => {
    const code = this.selectedNodeCode();
    if (!code) return [];
    return this.transitions().filter((t) => t.source_code === code);
  });

  readonly incoming = computed<PolicyTransition[]>(() => {
    const code = this.selectedNodeCode();
    if (!code) return [];
    return this.transitions().filter((t) => t.target_code === code);
  });

  readonly lanes = computed<LaneView[]>(() => {
    const map = new Map<string, PolicyNode[]>();
    for (const node of this.nodes()) {
      const arr = map.get(node.lane) ?? [];
      arr.push(node);
      map.set(node.lane, arr);
    }
    return Array.from(map.entries()).map(([lane, items]) => ({ lane, items }));
  });

  readonly laneNames = computed(() => this.lanes().map((l) => l.lane));
  readonly laneTopOffset = computed(() => this.laneTopPadding());
  readonly diagramHeight = computed(() => Math.max(420, this.laneTopOffset() + this.laneNames().length * this.laneRowHeight));

  readonly diagramNodes = computed<DiagramNodeView[]>(() => {
    const layout = this.nodeLayout();
    return this.nodes().map((node) => {
      const pos = layout[node.code] ?? this.defaultPosition(node.code, node.lane);
      const size = this.nodeSize(node.node_type);
      return {
        code: node.code,
        name: node.name,
        node_type: node.node_type,
        lane: node.lane,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
      };
    });
  });

  readonly diagramEdges = computed<DiagramEdgeView[]>(() => {
    const map = new Map(this.diagramNodes().map((n) => [n.code, n]));
    return this.transitions()
      .map((t, index) => {
        const from = map.get(t.source_code);
        const to = map.get(t.target_code);
        if (!from || !to) return null;
        const fromPort = this.edgePort(from, to, 'out');
        const toPort = this.edgePort(to, from, 'in');
        return {
          id: t._id ?? `edge-${index}`,
          fromX: fromPort.x,
          fromY: fromPort.y,
          toX: toPort.x,
          toY: toPort.y,
          labelX: (fromPort.x + toPort.x) / 2,
          labelY: (fromPort.y + toPort.y) / 2 - 12,
          label: t.condition_label ?? null,
          type: t.transition_type
        };
      })
      .filter((edge): edge is DiagramEdgeView => !!edge);
  });

  readonly stats = computed(() => {
    const nodes = this.nodes();
    return {
      total: nodes.length,
      actividades: nodes.filter((n) => n.node_type === 'actividad').length,
      decisiones: nodes.filter((n) => n.node_type === 'decision').length,
      transiciones: this.transitions().length
    };
  });

  readonly panelGuide = computed<PanelGuide>(() => {
    switch (this.panel()) {
      case 'inspector':
        return {
          title: 'Inspector',
          description: 'Muestra el nodo seleccionado: su calle, responsable, entradas, salidas y accesos rápidos.'
        };
      case 'add-node':
        return {
          title: 'Nodo',
          description: 'Sirve para crear un nuevo paso del proceso. Si escribes una calle nueva aquí, también estarás creando esa calle.'
        };
      case 'add-route':
        return {
          title: 'Ruta',
          description: 'Conecta nodos entre sí. Aquí defines a qué paso sigue el trámite y si la transición es secuencial, alternativa o paralela.'
        };
      case 'fields':
        return {
          title: 'Campos',
          description: 'Define el formulario que se llenará cuando un funcionario atienda el nodo seleccionado.'
        };
      case 'ai':
        return {
          title: 'IA',
          description: 'Describe el flujo en texto o voz. La IA puede adaptarlo a lo actual, proponerlo aparte o pensar un reemplazo.'
        };
    }
  });

  private dragState: {
    kind: 'node' | 'pan';
    nodeCode?: string;
    boardLeft: number;
    boardTop: number;
    offsetX: number;
    offsetY: number;
    startX?: number;
    startY?: number;
    initialOffsetX?: number;
    initialOffsetY?: number;
  } | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private speechRecognition:
    | {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        maxAlternatives: number;
        start: () => void;
        stop: () => void;
        onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
        onend: (() => void) | null;
        onerror: ((event: { error: string }) => void) | null;
      }
    | null = null;
  private audioChunks: Blob[] = [];
  private speechBasePrompt = '';
  private speechFinalPrompt = '';
  private pendingMouseEvent: MouseEvent | null = null;
  private animationFrameId: number | null = null;
  private refreshTimerId: number | null = null;
  private lastPolicyFingerprint = '';
  private laneControlsObserver: ResizeObserver | null = null;

  ngOnInit(): void {
    if (!this.canUseVoice()) {
      this.aiStatus.set(
        'Describe el flujo en lenguaje natural y aplica la propuesta. Este navegador no expone ni dictado ni grabación de audio.'
      );
    } else if (!this.voiceSupported() && this.recordingSupported()) {
      this.aiStatus.set(
        'Puedes escribir el flujo o grabar audio. Si el dictado directo no aparece, la app enviará la grabación a Gemini.'
      );
    }
    if (this.policyId) this.loadPolicy(this.policyId);
    this.startCollaborationRefresh();
    this.bindTourListeners();
  }

  ngAfterViewInit(): void {
    this.syncLaneTopPadding();
    if (typeof ResizeObserver !== 'undefined' && this.laneControlsRef?.nativeElement) {
      this.laneControlsObserver = new ResizeObserver(() => this.syncLaneTopPadding());
      this.laneControlsObserver.observe(this.laneControlsRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.speechRecognition?.stop();
    if (this.refreshTimerId !== null) {
      window.clearInterval(this.refreshTimerId);
      this.refreshTimerId = null;
    }
    this.laneControlsObserver?.disconnect();
    this.laneControlsObserver = null;
    this.unbindTourListeners();
  }

  private detectVoiceSupport(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  loadPolicy(policyId: string): void {
    this.loading.set(true);
    this.api.getPolicy(policyId).subscribe({
      next: (response) => {
        this.applyPolicySnapshot(response.data, false);
      },
      error: () => this.toast.error('No se pudo cargar la política'),
      complete: () => this.loading.set(false)
    });
  }

  private startCollaborationRefresh(): void {
    if (typeof window === 'undefined' || this.refreshTimerId !== null) return;
    this.refreshTimerId = window.setInterval(() => {
      void this.refreshPolicyIfChanged();
    }, 12000);
  }

  private async refreshPolicyIfChanged(): Promise<void> {
    if (!this.policyId || typeof document !== 'undefined' && document.hidden) return;
    if (this.loading() || this.organizing() || this.aiGenerating() || !!this.dragState) return;
    const current = this.policy();
    if (!current) return;
    try {
      const fresh = (await firstValueFrom(this.api.getPolicy(this.policyId))).data;
      const nextFingerprint = this.policyFingerprint(fresh);
      if (nextFingerprint === this.lastPolicyFingerprint) return;
      this.applyPolicySnapshot(fresh, true);
    } catch {
      // Silent background refresh failure
    }
  }

  private applyPolicySnapshot(snapshot: Policy, notifyRemote: boolean): void {
    const currentSelected = this.selectedNodeCode();
    this.policy.set(snapshot);
    const normalizedLayout = this.ensureLayout(snapshot, this.loadLayout(snapshot));
    this.nodeLayout.set(normalizedLayout);
    this.lastPolicyFingerprint = this.policyFingerprint(snapshot);

    const nodes = snapshot.nodes ?? [];
    const selectedStillExists = !!currentSelected && nodes.some((node) => node.code === currentSelected);
    if (selectedStillExists) {
      this.selectedNodeCode.set(currentSelected);
    } else if (nodes.length) {
      this.selectedNodeCode.set(nodes[0].code);
    } else {
      this.selectedNodeCode.set(null);
    }

    this.transitionForm.patchValue({
      source_code: nodes[0]?.code ?? '',
      target_code: nodes[1]?.code ?? nodes[0]?.code ?? ''
    });

    if (notifyRemote) {
      this.toast.info('Diseño actualizado', 'Se detectaron cambios recientes de otro usuario.');
    }
  }

  back(): void {
    this.router.navigateByUrl('/app/policies');
  }

  selectNode(code: string): void {
    this.selectedNodeCode.set(code);
    this.panel.set('inspector');
  }

  setPanel(panel: PanelKey): void {
    this.panel.set(panel);
    if (this.tourOpen()) {
      setTimeout(() => this.syncTourPosition(), 0);
    }
  }

  setAiStrategy(strategy: AIStrategy): void {
    this.aiStrategy.set(strategy);
  }

  toggleLaneList(): void {
    this.laneListCollapsed.update((value) => !value);
  }

  startLaneCreate(): void {
    this.creatingLane.set(true);
    this.newLaneName.set('');
  }

  cancelLaneCreate(): void {
    this.creatingLane.set(false);
    this.newLaneName.set('');
  }

  updateNewLaneName(value: string): void {
    this.newLaneName.set(value);
  }

  startLaneEdit(lane: string): void {
    this.editingLane.set(lane);
    this.laneDraft.set(lane);
  }

  cancelLaneEdit(): void {
    this.editingLane.set(null);
    this.laneDraft.set('');
  }

  updateLaneDraft(value: string): void {
    this.laneDraft.set(value);
  }

  async saveLaneEdit(originalLane: string): Promise<void> {
    const policy = this.policy();
    const nextLane = this.laneDraft().trim();
    if (!policy || !nextLane || nextLane === originalLane) {
      this.cancelLaneEdit();
      return;
    }

    const nodesToUpdate = this.nodes().filter((node) => node.lane === originalLane);
    if (!nodesToUpdate.length) {
      this.cancelLaneEdit();
      return;
    }

    for (const node of nodesToUpdate) {
      await firstValueFrom(
        this.api.updatePolicyNode(policy._id, node.code, {
          lane: nextLane,
          responsible_department: node.responsible_department === originalLane ? nextLane : node.responsible_department
        })
      );
    }

    this.toast.success('Calle actualizada', `${originalLane} ahora es ${nextLane}`);
    this.cancelLaneEdit();
    this.clearLayout(policy._id);
    this.loadPolicy(policy._id);
  }

  async deleteLane(lane: string): Promise<void> {
    const policy = this.policy();
    if (!policy) return;
    const nodesToUpdate = this.nodes().filter((node) => node.lane === lane);
    if (!nodesToUpdate.length) return;

    const fallbackLane = lane === 'General' ? 'Sistema' : 'General';
    for (const node of nodesToUpdate) {
      await firstValueFrom(
        this.api.updatePolicyNode(policy._id, node.code, {
          lane: fallbackLane,
          responsible_department: node.responsible_department === lane ? fallbackLane : node.responsible_department
        })
      );
    }

    this.toast.info('Calle eliminada', `Los nodos de ${lane} pasaron a ${fallbackLane}.`);
    this.cancelLaneEdit();
    this.clearLayout(policy._id);
    this.loadPolicy(policy._id);
  }

  async createLane(): Promise<void> {
    const policy = this.policy();
    const laneName = this.newLaneName().trim();
    if (!policy || !laneName) return;

    const existingLaneNames = new Set(this.laneNames().map((lane) => lane.toLowerCase()));
    if (existingLaneNames.has(laneName.toLowerCase())) {
      this.toast.warn('La calle ya existe', 'Usa otro nombre o edita la calle existente.');
      return;
    }

    let index = 1;
    const existingCodes = new Set(this.nodes().map((node) => node.code));
    let nodeCode = `ACT_${index}`;
    while (existingCodes.has(nodeCode)) {
      index += 1;
      nodeCode = `ACT_${index}`;
    }

    await firstValueFrom(
      this.api.addPolicyNode(policy._id, {
        code: nodeCode,
        name: `Actividad ${index}`,
        node_type: 'actividad',
        lane: laneName,
        responsible_role: 'funcionario',
        responsible_department: laneName,
        form_fields: []
      })
    );

    this.toast.success('Calle creada', `${laneName} ya está disponible en el diagrama.`);
    this.cancelLaneCreate();
    this.clearLayout(policy._id);
    this.loadPolicy(policy._id);
  }

  // ----- Quick actions -----
  async quickAdd(template: 'inicio' | 'actividad' | 'decision' | 'fin'): Promise<void> {
    const policy = this.policy();
    if (!policy) return;

    const lane =
      template === 'inicio' || template === 'fin'
        ? 'Sistema'
        : template === 'decision'
          ? 'Coordinación'
          : 'Atención al cliente';
    const baseName =
      template === 'inicio' ? 'Inicio' : template === 'fin' ? 'Fin' : template === 'decision' ? 'Decisión' : 'Actividad';
    const codeBase =
      template === 'inicio' ? 'START' : template === 'fin' ? 'END' : template === 'decision' ? 'DEC' : 'ACT';

    let index = 1;
    const existing = new Set(this.nodes().map((node) => node.code));
    let nextCode = `${codeBase}_${index}`;
    while (existing.has(nextCode)) {
      index += 1;
      nextCode = `${codeBase}_${index}`;
    }

    await firstValueFrom(
      this.api.addPolicyNode(policy._id, {
        code: nextCode,
        name: `${baseName} ${index}`,
        node_type: template,
        lane,
        responsible_role: lane === 'Sistema' ? null : 'funcionario',
        responsible_department: lane === 'Sistema' ? null : lane,
        form_fields: []
      })
    );
    this.toast.success('Nodo creado', `${nextCode} añadido al diagrama`);
    this.loadPolicy(policy._id);
  }

  async createNode(): Promise<void> {
    const policy = this.policy();
    if (!policy || this.nodeForm.invalid) {
      this.nodeForm.markAllAsTouched();
      return;
    }
    const raw = this.nodeForm.getRawValue();
    await firstValueFrom(
      this.api.addPolicyNode(policy._id, {
        code: raw.code as string,
        name: raw.name as string,
        node_type: raw.node_type as string,
        lane: raw.lane as string,
        responsible_role: raw.responsible_role || null,
        responsible_department: raw.responsible_department || null,
        form_fields: []
      })
    );
    this.toast.success('Nodo añadido');
    this.nodeForm.reset({
      code: '',
      name: '',
      node_type: 'actividad',
      lane: 'Atención al cliente',
      responsible_role: 'funcionario',
      responsible_department: 'Atención al cliente'
    });
    this.loadPolicy(policy._id);
  }

  async deleteNode(code: string): Promise<void> {
    const policy = this.policy();
    if (!policy) return;
    await firstValueFrom(this.api.deletePolicyNode(policy._id, code));
    this.toast.info('Nodo eliminado', code);
    if (this.selectedNodeCode() === code) this.selectedNodeCode.set(null);
    this.loadPolicy(policy._id);
  }

  async createTransition(): Promise<void> {
    const policy = this.policy();
    if (!policy || this.transitionForm.invalid) {
      this.transitionForm.markAllAsTouched();
      return;
    }
    const raw = this.transitionForm.getRawValue();
    await firstValueFrom(
      this.api.addPolicyTransition(policy._id, {
        source_code: raw.source_code as string,
        target_code: raw.target_code as string,
        condition_label: raw.condition_label || null,
        transition_type: raw.transition_type as string
      })
    );
    this.toast.success('Transición añadida');
    this.transitionForm.patchValue({ condition_label: '', transition_type: 'secuencial' });
    this.loadPolicy(policy._id);
  }

  async deleteTransition(transition: PolicyTransition): Promise<void> {
    const policy = this.policy();
    if (!policy || !transition._id) return;
    await firstValueFrom(this.api.deletePolicyTransition(policy._id, transition._id));
    this.toast.info('Transición eliminada');
    this.loadPolicy(policy._id);
  }

  async addField(): Promise<void> {
    const policy = this.policy();
    const node = this.selectedNode();
    if (!policy || !node || this.fieldForm.invalid) {
      this.fieldForm.markAllAsTouched();
      return;
    }
    const raw = this.fieldForm.getRawValue();
    const field = {
      key: raw.key as string,
      label: raw.label as string,
      field_type: raw.field_type as string,
      required: !!raw.required,
      options:
        raw.field_type === 'lista'
          ? (raw.options_text ?? '')
              .split(',')
              .map((opt) => opt.trim())
              .filter(Boolean)
          : []
    };
    await firstValueFrom(
      this.api.updatePolicyNode(policy._id, node.code, {
        form_fields: [...(node.form_fields ?? []), field]
      })
    );
    this.toast.success('Campo agregado al formulario del nodo');
    this.fieldForm.reset({
      key: '',
      label: '',
      field_type: 'texto',
      required: false,
      options_text: ''
    });
    this.loadPolicy(policy._id);
  }

  async removeField(key: string): Promise<void> {
    const policy = this.policy();
    const node = this.selectedNode();
    if (!policy || !node) return;
    await firstValueFrom(
      this.api.updatePolicyNode(policy._id, node.code, {
        form_fields: (node.form_fields ?? []).filter((field) => field.key !== key)
      })
    );
    this.toast.info('Campo eliminado');
    this.loadPolicy(policy._id);
  }

  validate(): void {
    const policy = this.policy();
    if (!policy) return;
    this.api.validatePolicy(policy._id).subscribe({
      next: (response) => {
        if (response.data.valid) this.toast.success('Política validada', 'Lista para publicarse');
        else this.toast.warn('Hay observaciones', response.data.observations.join(' · '));
        this.loadPolicy(policy._id);
      }
    });
  }

  publish(): void {
    const policy = this.policy();
    if (!policy) return;
    this.api.publishPolicy(policy._id).subscribe({
      next: () => {
        this.toast.success('Política publicada', 'Los trámites podrán usar esta política');
        this.loadPolicy(policy._id);
      }
    });
  }

  // ----- AI -----
  async generateAi(): Promise<void> {
    const prompt = this.aiForm.getRawValue().prompt?.trim() ?? '';
    if (!prompt) return;
    const policy = this.policy();
    const strategy = this.aiStrategy();
    const currentDiagramContext =
      strategy === 'adapt' && policy
        ? this.buildCurrentDiagramContext(policy)
        : null;
    const lanesVocabulary = this.laneNames().length
      ? `\n\nCalles ya existentes en esta politica: ${this.laneNames().join(', ')}. Si una propuesta encaja en una de estas, reutiliza ese nombre exactamente.`
      : '';
    const finalPrompt =
      strategy === 'adapt' && currentDiagramContext
        ? `${prompt}\n\nContexto del diagrama actual:\n${currentDiagramContext}\n\nAdapta la propuesta respetando lo ya existente cuando tenga sentido.${lanesVocabulary}`
        : `${prompt}${lanesVocabulary}`;
    this.aiGenerating.set(true);
    this.aiErrorDetail.set(null);
    this.aiSuggestion.set(null);
    this.aiStatus.set(
      strategy === 'adapt'
        ? 'Consultando Gemini para adaptar la propuesta sobre el flujo actual...'
        : strategy === 'replace'
          ? 'Consultando Gemini para proponer un reemplazo completo del diagrama...'
          : 'Consultando Gemini para generar una propuesta de flujo...'
    );
    try {
      const response = await firstValueFrom(
        this.api.generateWorkflowSuggestion({
          prompt: finalPrompt,
          policy_name: policy?.name ?? null,
          procedure_type: policy?.procedure_type ?? null,
          policy_description: policy?.description ?? null,
        })
      );
      this.aiSuggestion.set(this.normalizeSuggestionToKnownLanes(response.data));
      const sourceLabel = response.data.source === 'fallback' ? 'respaldo local' : 'Gemini';
      this.aiStatus.set(`${sourceLabel} generó una propuesta. Revísala y aplícala si te convence.`);
      if (response.data.source === 'fallback') {
        this.aiErrorDetail.set('Gemini respondió en un formato inválido y se usó una propuesta base para no dejarte sin resultado.');
        this.pushAiHistory('text', 'fallback', response.data.title, response.data.summary);
      } else {
        this.pushAiHistory('text', 'success', response.data.title, response.data.summary);
      }
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.toast.error('No se pudo generar la propuesta con IA');
      this.aiSuggestion.set(null);
      this.aiErrorDetail.set(message);
      this.aiStatus.set('La IA no respondió correctamente. Puedes intentar de nuevo o editar el prompt.');
      this.pushAiHistory('text', 'error', 'Error al generar propuesta', message);
    } finally {
      this.aiGenerating.set(false);
    }
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
    this.aiStatus.set('Este navegador no expone dictado directo ni grabación.');
    this.aiErrorDetail.set(
      'Aquí no hay soporte de voz disponible. Puedes seguir escribiendo el flujo manualmente.'
    );
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
      this.aiStatus.set('Este navegador no expone dictado directo. Si puedes, usa la grabación de audio.');
      this.aiErrorDetail.set(
        'El dictado inmediato depende del motor del navegador. La grabación de audio sigue disponible cuando el navegador permite micrófono.'
      );
      return;
    }

    const recognition = new (Ctor as new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      maxAlternatives: number;
      start: () => void;
      stop: () => void;
      onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> }) => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
    })();

    this.speechRecognition = recognition;
    this.speechBasePrompt = this.aiForm.getRawValue().prompt?.trim() ?? '';
    this.speechFinalPrompt = '';
    this.aiLiveTranscript.set('');
    this.aiErrorDetail.set(null);

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

      this.speechFinalPrompt = `${this.speechFinalPrompt} ${finalChunk}`.trim();
      const finalized = `${this.speechBasePrompt} ${this.speechFinalPrompt}`.trim();
      const live = `${finalized} ${interimChunk}`.trim();

      this.aiLiveTranscript.set(interimChunk.trim());
      this.aiForm.patchValue({ prompt: live || finalized || this.speechBasePrompt });
      this.aiStatus.set(interimChunk.trim() ? 'Escuchando y escribiendo en vivo...' : 'Voz capturada. Sigue hablando o detén el dictado cuando termines.');
    };
    recognition.onerror = (event) => {
      this.aiStatus.set(`No se pudo capturar voz: ${event.error}.`);
      this.aiErrorDetail.set(
        'La captura por voz depende del soporte del navegador. En el navegador integrado puede fallar; Chrome o Edge suelen funcionar mejor.'
      );
      this.pushAiHistory('voice', 'error', 'Error de voz', event.error);
      this.aiListening.set(false);
      this.aiLiveTranscript.set('');
      this.speechRecognition = null;
    };
    recognition.onend = () => {
      const finalPrompt = this.aiForm.getRawValue().prompt?.trim() ?? '';
      this.aiListening.set(false);
      this.aiLiveTranscript.set('');
      this.speechRecognition = null;
      this.aiStatus.set(finalPrompt ? 'Dictado finalizado. Revisa el texto y luego genera la propuesta.' : 'No se capturó texto útil. Puedes intentarlo otra vez o escribir el flujo manualmente.');
      if (finalPrompt) {
        this.pushAiHistory('voice', 'success', 'Voz capturada', finalPrompt);
      }
    };
    this.aiListening.set(true);
    this.aiStatus.set('Escuchando y escribiendo en vivo...');
    recognition.start();
  }

  async applyAi(): Promise<void> {
    await this.applyAiWithStrategy(this.aiStrategy() === 'replace' ? 'replace' : 'merge');
  }

  async replaceWithAi(): Promise<void> {
    await this.applyAiWithStrategy('replace');
  }

  private async applyAiWithStrategy(strategy: 'merge' | 'replace'): Promise<void> {
    const policy = this.policy();
    const suggestion = this.aiSuggestion();
    if (!policy || !suggestion) return;

    if (strategy === 'replace') {
      const transitions = [...(policy.transitions ?? [])];
      for (const transition of transitions) {
        if (transition._id) {
          await firstValueFrom(this.api.deletePolicyTransition(policy._id, transition._id));
        }
      }

      const nodes = [...(policy.nodes ?? [])];
      for (const node of nodes) {
        await firstValueFrom(this.api.deletePolicyNode(policy._id, node.code));
      }
    }

    const latestPolicy =
      strategy === 'replace'
        ? (await firstValueFrom(this.api.getPolicy(policy._id))).data
        : policy;

    const existingNodes = new Map((latestPolicy.nodes ?? []).map((n) => [n.code, n]));
    const existing = new Set(existingNodes.keys());
    for (const node of suggestion.nodes) {
      if (!existing.has(node.code)) {
        await firstValueFrom(this.api.addPolicyNode(policy._id, { ...node, form_fields: [] }));
        existing.add(node.code);
        existingNodes.set(node.code, {
          ...node,
          form_fields: [],
        });
      } else {
        const currentNode = existingNodes.get(node.code);
        if (
          currentNode &&
          (
            currentNode.name !== node.name ||
            currentNode.lane !== node.lane ||
            currentNode.node_type !== node.node_type ||
            (currentNode.responsible_role ?? null) !== (node.responsible_role ?? null) ||
            (currentNode.responsible_department ?? null) !== (node.responsible_department ?? null)
          )
        ) {
          await firstValueFrom(
            this.api.updatePolicyNode(policy._id, node.code, {
              name: node.name,
              lane: node.lane,
              node_type: node.node_type,
              responsible_role: node.responsible_role ?? null,
              responsible_department: node.responsible_department ?? null,
            })
          );
        }
      }
    }
    const refreshed = await firstValueFrom(this.api.getPolicy(policy._id));
    const existingT = new Set(
      (refreshed.data.transitions ?? []).map(
        (t) => `${t.source_code}-${t.target_code}-${t.condition_label ?? ''}`
      )
    );
    for (const transition of suggestion.transitions) {
      const key = `${transition.source_code}-${transition.target_code}-${transition.condition_label ?? ''}`;
      if (!existingT.has(key)) {
        await firstValueFrom(this.api.addPolicyTransition(policy._id, transition));
      }
    }
    this.toast.success(
      strategy === 'replace' ? 'Diagrama reemplazado' : 'Propuesta aplicada',
      strategy === 'replace' ? 'El flujo anterior fue sustituido por la propuesta de IA.' : 'El diagrama se actualizó con la sugerencia de IA'
    );
    this.clearLayout(policy._id);
    this.loadPolicy(policy._id);
  }

  // ----- Canvas -----
  setZoom(level: number): void {
    this.zoomLevel.set(Math.max(0.5, Math.min(1.6, Number(level.toFixed(2)))));
  }

  zoomIn(): void { this.setZoom(this.zoomLevel() + 0.1); }
  zoomOut(): void { this.setZoom(this.zoomLevel() - 0.1); }
  resetView(): void {
    this.zoomLevel.set(1);
    this.canvasOffset.set({ x: 0, y: 0 });
  }

  startCanvasPan(event: MouseEvent, board: HTMLElement): void {
    if ((event.target as HTMLElement)?.closest('.diagram-card')) return;
    event.preventDefault();
    const rect = board.getBoundingClientRect();
    const offset = this.canvasOffset();
    this.dragState = {
      kind: 'pan',
      boardLeft: rect.left,
      boardTop: rect.top,
      offsetX: 0,
      offsetY: 0,
      startX: event.clientX,
      startY: event.clientY,
      initialOffsetX: offset.x,
      initialOffsetY: offset.y
    };
  }

  startNodeDrag(code: string, event: MouseEvent, board: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    const current = this.nodeLayout()[code] ?? { ...this.defaultPosition(code), lane: this.nodes().find((node) => node.code === code)?.lane ?? 'Sistema' };
    const rect = board.getBoundingClientRect();
    const offset = this.canvasOffset();
    const zoom = this.zoomLevel();
    this.dragState = {
      kind: 'node',
      nodeCode: code,
      boardLeft: rect.left,
      boardTop: rect.top,
      offsetX: (event.clientX - rect.left - offset.x) / zoom - current.x,
      offsetY: (event.clientY - rect.top - offset.y) / zoom - current.y
    };
    this.selectNode(code);
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.dragState) return;
    this.pendingMouseEvent = event;
    if (this.animationFrameId !== null) return;
    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.flushMouseMove();
    });
  }

  @HostListener('window:mouseup')
  onMouseUp(): void {
    this.flushMouseMove();
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (!this.dragState) return;
    const policy = this.policy();
    if (policy) this.saveLayout(policy._id, this.nodeLayout());
    this.dragState = null;
    this.pendingMouseEvent = null;
  }

  edgePath(edge: DiagramEdgeView): string {
    const { fromX, fromY, toX, toY } = edge;
    const r = 10;
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (Math.abs(dy) < 6) {
      return `M ${fromX} ${fromY} L ${toX} ${toY}`;
    }

    if (dx > 60) {
      const midX = fromX + Math.max(40, dx / 2);
      const sign = dy > 0 ? 1 : -1;
      return [
        `M ${fromX} ${fromY}`,
        `L ${midX - r} ${fromY}`,
        `Q ${midX} ${fromY} ${midX} ${fromY + sign * r}`,
        `L ${midX} ${toY - sign * r}`,
        `Q ${midX} ${toY} ${midX + r} ${toY}`,
        `L ${toX} ${toY}`
      ].join(' ');
    }

    const detour = 56;
    const top = Math.min(fromY, toY) - detour;
    const rightX = fromX + 36;
    const leftX = toX - 36;
    return [
      `M ${fromX} ${fromY}`,
      `L ${rightX - r} ${fromY}`,
      `Q ${rightX} ${fromY} ${rightX} ${fromY - r}`,
      `L ${rightX} ${top + r}`,
      `Q ${rightX} ${top} ${rightX - r} ${top}`,
      `L ${leftX + r} ${top}`,
      `Q ${leftX} ${top} ${leftX} ${top + r}`,
      `L ${leftX} ${toY - r}`,
      `Q ${leftX} ${toY} ${leftX + r} ${toY}`,
      `L ${toX} ${toY}`
    ].join(' ');
  }

  markerForTransition(type: string): string {
    const map: Record<string, string> = {
      alternativa: 'uml-arrow-alternative',
      iterativa: 'uml-arrow-iterative',
      paralela: 'uml-arrow-parallel',
    };
    return map[type] ?? 'uml-arrow-sequential';
  }

  autoOrganize(): void {
    const policy = this.policy();
    if (!policy) return;
    const nodes = this.nodes();
    if (!nodes.length) return;
    if (this.organizing()) return;
    this.organizing.set(true);
    this.aiStatus.set('Reordenando el diagrama para que sea más legible...');

    window.requestAnimationFrame(() => {
      const transitions = this.transitions();
      const lanesOrder = this.laneNames();
      const depth = new Map<string, number>();

      const seeds = nodes.filter((n) => n.node_type === 'inicio');
      const queue: Array<{ code: string; level: number }> = (seeds.length ? seeds : [nodes[0]]).map((n) => ({
        code: n.code,
        level: 0
      }));
      for (const item of queue) depth.set(item.code, 0);

      while (queue.length) {
        const { code, level } = queue.shift()!;
        for (const t of transitions.filter((tr) => tr.source_code === code)) {
          const next = level + 1;
          const existing = depth.get(t.target_code);
          if (existing === undefined || existing < next) {
            depth.set(t.target_code, next);
            queue.push({ code: t.target_code, level: next });
          }
        }
      }

      let orphan = 0;
      for (const n of nodes) {
        if (!depth.has(n.code)) {
          depth.set(n.code, orphan++);
        }
      }

      const layout: Record<string, NodeLayoutEntry> = {};
      const usedSlots = new Map<string, Set<number>>();

      for (const n of nodes) {
        const laneIndex = Math.max(0, lanesOrder.indexOf(n.lane));
        let column = depth.get(n.code) ?? 0;
        const slots = usedSlots.get(n.lane) ?? new Set<number>();
        while (slots.has(column)) column += 1;
        slots.add(column);
        usedSlots.set(n.lane, slots);

        layout[n.code] = {
          x: 52 + column * 250,
          y: this.laneTopForIndex(laneIndex) + this.nodeLaneOffset(n.node_type),
          lane: n.lane,
        };
      }

      this.nodeLayout.set(layout);
      this.saveLayout(policy._id, layout);
      this.canvasOffset.set({ x: 0, y: 0 });
      this.zoomLevel.set(1);
      this.organizing.set(false);
      this.toast.success('Diagrama organizado', 'Los nodos se acomodaron por carril y profundidad.');
    });
  }

  badgeForType(type: string): string {
    if (type === 'inicio') return 'success';
    if (type === 'fin') return 'danger';
    if (type === 'decision') return 'warn';
    if (type === 'fork' || type === 'join') return 'violet';
    return 'info';
  }

  policyStatusBadge(status: string | undefined): string {
    if (!status) return 'neutral';
    const map: Record<string, string> = {
      borrador: 'neutral',
      validada: 'info',
      publicada: 'success',
      archivada: 'danger'
    };
    return map[status] ?? 'neutral';
  }

  // ----- Helpers -----
  trackNode = (_: number, node: DiagramNodeView): string => node.code;
  trackEdge = (_: number, edge: DiagramEdgeView): string => edge.id;
  trackLane = (_: number, lane: { lane: string }): string => lane.lane;
  trackTransition = (_: number, transition: PolicyTransition): string =>
    transition._id ?? `${transition.source_code}-${transition.target_code}-${transition.condition_label ?? ''}`;
  trackField = (_: number, field: { key: string }): string => field.key;
  trackSuggestionNode = (_: number, node: { code: string }): string => node.code;
  trackAiHistory = (_: number, item: AIHistoryItem): string => item.id;

  private titleCase(text: string): string {
    return text
      .split(' ')
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
      .join(' ');
  }

  private pushAiHistory(mode: 'text' | 'voice', status: 'success' | 'error' | 'fallback', title: string, detail: string): void {
    const item: AIHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      status,
      title,
      detail,
      at: new Date().toLocaleTimeString(),
    };
    this.aiHistory.update((items) => [item, ...items].slice(0, 8));
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
      this.aiErrorDetail.set('Tu navegador no permite grabar audio desde esta pagina.');
      this.pushAiHistory('voice', 'error', 'Audio no disponible', 'No hay soporte de grabacion en este navegador.');
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
      this.aiErrorDetail.set(null);
      this.aiStatus.set('Grabando audio para Gemini...');
      this.pushAiHistory('voice', 'success', 'Grabacion iniciada', 'Escuchando audio del usuario.');
    } catch (error) {
      this.aiErrorDetail.set('No se pudo acceder al microfono.');
      this.aiStatus.set('No se pudo acceder al microfono.');
      this.pushAiHistory('voice', 'error', 'Microfono bloqueado', String(error));
    }
  }

  private async processRecordedAudio(mimeType: string): Promise<void> {
    const blob = new Blob(this.audioChunks, { type: mimeType });
    if (!blob.size) {
      this.aiErrorDetail.set('No se capturo audio util.');
      this.aiStatus.set('No se capturo audio util.');
      this.pushAiHistory('voice', 'error', 'Audio vacio', 'La grabacion no produjo contenido util.');
      return;
    }

    this.aiGenerating.set(true);
    try {
      const audioBase64 = await this.blobToBase64(blob);
      const response = await firstValueFrom(
        this.api.transcribeAudio({ audio_base64: audioBase64, mime_type: mimeType })
      );
      this.aiForm.patchValue({ prompt: response.transcript });
      this.aiStatus.set('Transcripcion lista. Revisa el texto y luego genera la propuesta de flujo.');
      this.aiErrorDetail.set(null);
      this.pushAiHistory('voice', 'success', 'Voz transcripta', response.transcript);
    } catch (error) {
      const message =
        error instanceof HttpErrorResponse
          ? error.error?.detail ?? error.message ?? 'Error desconocido'
          : 'Error desconocido';
      this.aiStatus.set('No se pudo transcribir el audio.');
      this.aiErrorDetail.set(message);
      this.pushAiHistory('voice', 'error', 'Error al transcribir audio', message);
    } finally {
      this.aiGenerating.set(false);
      this.aiRecording.set(false);
      this.aiListening.set(false);
      this.audioChunks = [];
    }
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

  private layoutKey(policyId: string): string {
    return `workflow_ia_layout_v2_${policyId}`;
  }

  private loadLayout(policy: Policy): Record<string, NodeLayoutEntry> {
    try {
      const raw = localStorage.getItem(this.layoutKey(policy._id));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, { x: number; y: number; lane?: string }>;
      const next: Record<string, NodeLayoutEntry> = {};
      for (const [code, value] of Object.entries(parsed)) {
        const lane = value.lane ?? policy.nodes.find((node) => node.code === code)?.lane ?? 'Sistema';
        next[code] = { x: value.x, y: value.y, lane };
      }
      return next;
    } catch {
      return {};
    }
  }

  private saveLayout(policyId: string, layout: Record<string, NodeLayoutEntry>): void {
    localStorage.setItem(this.layoutKey(policyId), JSON.stringify(layout));
  }

  private clearLayout(policyId: string): void {
    localStorage.removeItem(this.layoutKey(policyId));
    this.nodeLayout.set({});
  }

  private ensureLayout(policy: Policy, existing: Record<string, NodeLayoutEntry>): Record<string, NodeLayoutEntry> {
    const next = { ...existing };
    let changed = false;
    for (const node of policy.nodes ?? []) {
      const current = next[node.code];
      if (!current) {
        next[node.code] = { ...this.defaultPosition(node.code, node.lane), lane: node.lane };
        changed = true;
        continue;
      }
      if (current.lane !== node.lane) {
        next[node.code] = { ...this.defaultPosition(node.code, node.lane), lane: node.lane };
        changed = true;
      }
    }
    const valid = new Set((policy.nodes ?? []).map((n) => n.code));
    for (const code of Object.keys(next)) {
      if (!valid.has(code)) {
        delete next[code];
        changed = true;
      }
    }
    if (changed) {
      this.saveLayout(policy._id, next);
    }
    return next;
  }

  private defaultPosition(code: string, explicitLane?: string): { x: number; y: number } {
    const node = this.nodes().find((item) => item.code === code);
    const laneName =
      explicitLane ??
      node?.lane ??
      this.laneNames()[0] ??
      'Sistema';
    const laneIndex = Math.max(0, this.laneNames().indexOf(laneName));
    const laneNodes = this.nodes().filter((node) => node.lane === laneName);
    const indexWithinLane = Math.max(0, laneNodes.findIndex((node) => node.code === code));
    return {
      x: 52 + indexWithinLane * 250,
      y: this.laneTopForIndex(laneIndex) + this.nodeLaneOffset(node?.node_type ?? 'actividad')
    };
  }

  laneTopForIndex(index: number): number {
    return this.laneTopOffset() + index * this.laneRowHeight;
  }

  private syncLaneTopPadding(): void {
    const element = this.laneControlsRef?.nativeElement;
    if (!element) return;
    const next = Math.max(40, Math.round(element.getBoundingClientRect().height + 8));
    if (Math.abs(next - this.laneTopPadding()) > 1) {
      this.laneTopPadding.set(next);
    }
  }

  private flushMouseMove(): void {
    if (!this.dragState || !this.pendingMouseEvent) return;
    const event = this.pendingMouseEvent;
    const policy = this.policy();
    if (this.dragState.kind === 'pan') {
      this.canvasOffset.set({
        x: (this.dragState.initialOffsetX ?? 0) + (event.clientX - (this.dragState.startX ?? 0)),
        y: 0
      });
      return;
    }
    if (!policy || !this.dragState.nodeCode) return;
    const node = this.nodes().find((n) => n.code === this.dragState?.nodeCode);
    if (!node) return;

    const zoom = this.zoomLevel();
    const offset = this.canvasOffset();
    const laneIndex = Math.max(0, this.laneNames().indexOf(node.lane));
    const size = this.nodeSize(node.node_type);
    const laneTop = this.laneTopForIndex(laneIndex) + 18;
    const laneBottom = this.laneTopForIndex(laneIndex) + this.laneRowHeight - size.height - 18;
    const nextX = Math.max(20, (event.clientX - this.dragState.boardLeft - offset.x) / zoom - this.dragState.offsetX);
    const nextY = Math.max(laneTop, (event.clientY - this.dragState.boardTop - offset.y) / zoom - this.dragState.offsetY);
    const snapped = Math.min(Math.max(laneTop, laneBottom), Math.max(laneTop, nextY));

      this.nodeLayout.update((layout) => ({
        ...layout,
        [this.dragState!.nodeCode!]: { x: nextX, y: snapped, lane: node.lane }
      }));
  }

  private nodeSize(type: string): { width: number; height: number } {
    return this.umlNodeSizes[type] ?? this.defaultNodeSize;
  }

  private nodeLaneOffset(type: string): number {
    const size = this.nodeSize(type);
    return Math.max(18, Math.round((this.laneRowHeight - size.height) / 2));
  }

  private edgePort(node: DiagramNodeView, other: DiagramNodeView, mode: 'in' | 'out'): { x: number; y: number } {
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    const otherCenterX = other.x + other.width / 2;
    const otherCenterY = other.y + other.height / 2;
    const dx = otherCenterX - centerX;
    const dy = otherCenterY - centerY;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { x: node.x + node.width, y: centerY }
        : { x: node.x, y: centerY };
    }

    if (mode === 'out') {
      return dy >= 0
        ? { x: centerX, y: node.y + node.height }
        : { x: centerX, y: node.y };
    }

    return dy >= 0
      ? { x: centerX, y: node.y }
      : { x: centerX, y: node.y + node.height };
  }

  private normalizeSuggestionToKnownLanes(suggestion: WorkflowSuggestion): WorkflowSuggestion {
    const knownLanes = this.laneNames();
    if (!knownLanes.length) return suggestion;
    const knownMap = new Map(knownLanes.map((lane) => [this.slugify(lane), lane]));
    return {
      ...suggestion,
      nodes: suggestion.nodes.map((node) => {
        const direct = knownMap.get(this.slugify(node.lane));
        if (direct) {
          return {
            ...node,
            lane: direct,
            responsible_department: node.responsible_department ? direct : node.responsible_department,
          };
        }
        const compatible = knownLanes.find((lane) => {
          const laneSlug = this.slugify(lane);
          const nodeSlug = this.slugify(node.lane);
          return laneSlug.includes(nodeSlug) || nodeSlug.includes(laneSlug);
        });
        return compatible
          ? {
              ...node,
              lane: compatible,
              responsible_department: node.responsible_department ? compatible : node.responsible_department,
            }
          : node;
      }),
    };
  }

  private policyFingerprint(policy: Policy): string {
    return JSON.stringify({
      status: policy.status,
      version: policy.version,
      nodes: [...(policy.nodes ?? [])]
        .map((node) => ({
          code: node.code,
          name: node.name,
          lane: node.lane,
          node_type: node.node_type,
          responsible_role: node.responsible_role ?? null,
          responsible_department: node.responsible_department ?? null,
          form_fields: (node.form_fields ?? []).map((field) => ({
            key: field.key,
            label: field.label,
            type: field.field_type,
            required: field.required,
            options: field.options ?? [],
          })),
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      transitions: [...(policy.transitions ?? [])]
        .map((transition) => ({
          source_code: transition.source_code,
          target_code: transition.target_code,
          transition_type: transition.transition_type,
          condition_label: transition.condition_label ?? null,
        }))
        .sort((a, b) =>
          `${a.source_code}-${a.target_code}-${a.condition_label ?? ''}`.localeCompare(
            `${b.source_code}-${b.target_code}-${b.condition_label ?? ''}`
          )
        ),
    });
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toLowerCase();
  }

  private buildCurrentDiagramContext(policy: Policy): string {
    const lanes = Array.from(new Set((policy.nodes ?? []).map((node) => node.lane)));
    const nodes = (policy.nodes ?? [])
      .map((node) => `${node.code}: ${node.name} [${node.node_type}] lane=${node.lane}`)
      .join('\n');
    const transitions = (policy.transitions ?? [])
      .map((transition) => `${transition.source_code} -> ${transition.target_code} (${transition.transition_type}${transition.condition_label ? `: ${transition.condition_label}` : ''})`)
      .join('\n');

    return `Calles: ${lanes.join(', ')}\nNodos:\n${nodes}\nTransiciones:\n${transitions}`;
  }

  currentTourStep(): PageTourStep {
    return this.tourSteps[this.tourIndex()] ?? this.tourSteps[0];
  }

  isTourFocus(target: TourTarget): boolean {
    return this.tourOpen() && this.currentTourStep().target === target;
  }

  nextTourStep(): void {
    if (this.tourIndex() >= this.tourSteps.length - 1) {
      this.closeTour();
      return;
    }
    const nextIndex = this.tourIndex() + 1;
    this.tourIndex.set(nextIndex);
    if (this.tourSteps[nextIndex].target === 'designer-rail') {
      this.panel.set('ai');
    }
    this.syncTourPosition();
  }

  previousTourStep(): void {
    if (this.tourIndex() <= 0) return;
    this.tourIndex.update((value) => value - 1);
    this.syncTourPosition();
  }

  closeTour(): void {
    this.tourOpen.set(false);
  }

  private bindTourListeners(): void {
    if (typeof window === 'undefined') return;
    const handler = () => this.zone.run(() => this.syncTourPosition());
    this.resizeTourHandler = handler;
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('workflow-ia:start-tour', this.handleTourRequest as EventListener);
  }

  private unbindTourListeners(): void {
    if (typeof window === 'undefined') return;
    if (this.resizeTourHandler) {
      window.removeEventListener('resize', this.resizeTourHandler);
      window.removeEventListener('scroll', this.resizeTourHandler, true);
    }
    window.removeEventListener('workflow-ia:start-tour', this.handleTourRequest as EventListener);
  }

  private readonly handleTourRequest = (event: CustomEvent<{ route?: string }>) => {
    if (event.detail?.route !== 'policy-designer') return;
    this.startTour();
  };

  private startTour(): void {
    this.panel.set('ai');
    this.tourIndex.set(0);
    this.tourOpen.set(true);
    setTimeout(() => this.syncTourPosition(), 0);
  }

  private syncTourPosition(): void {
    if (!this.tourOpen() || typeof document === 'undefined' || typeof window === 'undefined') return;
    const element = document.querySelector<HTMLElement>(`[data-tour="${this.currentTourStep().target}"]`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const bubbleWidth = 360;
    const spacing = 18;
    let left = rect.left;
    let top = rect.bottom + spacing;
    if (left + bubbleWidth > window.innerWidth - 24) {
      left = Math.max(16, window.innerWidth - bubbleWidth - 24);
    }
    if (top + 240 > window.innerHeight - 16) {
      top = Math.max(16, rect.top - 240 - spacing);
    }
    this.tourBubble.set({ top, left });
  }
}
