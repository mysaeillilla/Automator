import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const API_BASE = 'https://localhost:5001/api';

/** A variable type from GET /api/Core/variable-types. */
interface VarTypeDef {
  name: string;
  description: string;
  example: string | null;
  /** value is typed as JSON text (JSON / DATATABLE / ROW) */
  structured: boolean;
}

/** Used until the endpoint answers (and if it fails). ANY is internal and never offered. */
const DEFAULT_VAR_TYPE_DEFS: VarTypeDef[] = [
  { name: 'STRING', description: 'Text.', example: 'Hello', structured: false },
  { name: 'NUMBER', description: 'Integer or decimal number.', example: '125.50', structured: false },
  { name: 'BOOLEAN', description: 'True or false.', example: 'true', structured: false },
  { name: 'JSON', description: 'JSON object or array.', example: '{"name": "Saeil", "tags": [1, 2, 3]}', structured: true },
  { name: 'DATATABLE', description: 'Table containing rows and columns.', example: '[{"name": "Saeil", "age": 34}]', structured: true },
  { name: 'ROW', description: 'Single row of a DataTable.', example: '{"name": "Saeil", "age": 34}', structured: true },
];
type VarType = string;

/** Inputs/outputs of these types only accept variables of the same type (a table, a row). */
const STRICT_TYPES = new Set(['DATATABLE', 'ROW']);

const UNARY_OPERATORS = new Set(['IsEmpty', 'IsNotEmpty', 'IsNull', 'IsNotNull', 'IsTrue', 'IsFalse']);
const NUMERIC_TYPES = ['NUMBER', 'INT', 'INTEGER', 'LONG', 'DOUBLE', 'FLOAT', 'DECIMAL'];
const KNOWN_BLOCKS = ['Then', 'Else', 'Body', 'Catch'];
const TEMPLATE_REGEX = /\{\{\s*([A-Za-z_]\w*)/g;

interface ActionDef {
  id: number;
  packageId: number;
  name: string;
  description: string;
  category: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  blocks: string[];
  hasCondition: boolean;
  conditionOperators: string[];
  logicalOperators: string[];
  supportsMultipleConditions: boolean;
  properties: Record<string, string>;
}

interface PackageDef {
  id: number;
  name: string;
  version: string;
  filePath: string | null;
  description: string;
  dependencies: string[];
  isBuiltIn: boolean;
  actions: ActionDef[];
}

interface PaletteGroup {
  name: string;
  actions: ActionDef[];
}

interface FlowCondition {
  left: string;
  operator: string;
  right: string;
}

interface FlowNode {
  uid: string;
  pkg: string; // ClassName
  fn: string; // FunctionName
  def: ActionDef | null;
  inputs: Record<string, string>;
  outputs: Record<string, string>; // key -> variable name (without {{ }})
  condition: FlowCondition | null;
  blocks: Record<string, FlowNode[]>;
}

interface FlowVariable {
  name: string;
  type: VarType;
  value: unknown;
  input: boolean;
  output: boolean;
}

interface NodeLocation {
  node: FlowNode;
  list: FlowNode[];
  index: number;
  owner: string | null;
  block: string;
}

interface ActionDraft {
  node: FlowNode;
  inputFields: { key: string; type: string; long: boolean }[];
  outputFields: { key: string; type: string }[];
  outputKeys: string[];
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  condition: FlowCondition | null;
  operators: string[];
}

interface VarDraft {
  editing: boolean;
  name: string;
  type: VarType;
  valueText: string;
  input: boolean;
  output: boolean;
}

type DragPayload = { kind: 'new'; pkg: string; fn: string } | { kind: 'move'; uid: string };

@Component({
  imports: [FormsModule, NgTemplateOutlet],
  selector: 'app-workflow',
  styleUrl: './workflow.css',
  templateUrl: './workflow.html',
})
export class Workflow {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private uidSeq = 0;
  private payload: DragPayload | null = null;
  private pendingWorkflow: any = null;

  // ---- workflow loading ----
  readonly workflowId = signal<string | null>(null);
  readonly workflowLoading = signal(false);
  readonly workflowError = signal('');
  readonly packagesLoaded = signal(false);

  // ---- state ----
  readonly flowName = signal('Core Actions Demo');
  readonly version = signal('1.0.0');
  readonly packages = signal<PackageDef[]>([]);
  readonly packagesLoading = signal(false);
  readonly packagesError = signal('');

  /** Variable types offered when creating a variable (loaded from the backend). */
  readonly varTypeDefs = signal<VarTypeDef[]>(DEFAULT_VAR_TYPE_DEFS);
  readonly varTypesLoading = signal(false);
  readonly varTypesError = signal('');
  /** Names only; kept so code that used `varTypes` keeps working. */
  get varTypes(): readonly string[] {
    return this.varTypeDefs().map((t) => t.name);
  }

  readonly actions = signal<FlowNode[]>([]);
  readonly variables = signal<FlowVariable[]>([]);
  readonly selectedUid = signal<string | null>(null);

  readonly paletteQuery = signal('');
  readonly varQuery = signal('');
  readonly collapsed = signal<Set<string>>(new Set());

  readonly dragging = signal(false);
  readonly dropKey = signal<string | null>(null);

  readonly draft = signal<ActionDraft | null>(null);
  readonly varDraft = signal<VarDraft | null>(null);
  readonly varError = signal('');

  readonly showJson = signal(false);
  readonly importOpen = signal(false);
  readonly importText = signal('');
  readonly importError = signal('');
  /** Notes about variables converted from the old types (LIST / ANY) when a workflow was opened. */
  readonly migrationNotes = signal<string[]>([]);

  readonly uploading = signal(false);
  readonly uploadResult = signal<{ ok: boolean; body: string } | null>(null);

  // ---- derived ----
  readonly catalog = computed(() => {
    const pkgs = this.packages();
    const hasBuiltInCore = pkgs.some((p) => p.name === 'Core' && p.isBuiltIn);
    const map = new Map<string, { pkg: PackageDef; def: ActionDef }>();
    for (const p of pkgs) {
      if (p.name === 'Core' && !p.isBuiltIn && hasBuiltInCore) continue; // duplicate, no block info
      for (const a of p.actions) map.set(`${p.name}.${a.name}`, { pkg: p, def: a });
    }
    return map;
  });

  readonly groups = computed<PaletteGroup[]>(() => {
    const q = this.paletteQuery().trim().toLowerCase();
    const byPkg = new Map<string, PaletteGroup>();
    for (const { pkg, def } of this.catalog().values()) {
      if (q && !def.name.toLowerCase().includes(q) && !(def.description ?? '').toLowerCase().includes(q)) continue;
      let g = byPkg.get(pkg.name);
      if (!g) {
        g = { name: pkg.name, actions: [] };
        byPkg.set(pkg.name, g);
      }
      g.actions.push(def);
    }
    return [...byPkg.values()];
  });

  readonly lineNumbers = computed(() => {
    const map = new Map<string, number>();
    let n = 0;
    const walk = (list: FlowNode[]) => {
      for (const node of list) {
        map.set(node.uid, ++n);
        for (const b of Object.keys(node.blocks)) walk(node.blocks[b]);
      }
    };
    walk(this.actions());
    return map;
  });
  readonly actionCount = computed(() => this.lineNumbers().size);

  readonly filteredVariables = computed(() => {
    const q = this.varQuery().trim().toLowerCase();
    return this.variables().filter((v) => !q || v.name.toLowerCase().includes(q));
  });

  /** Variables created by Variable.Create actions that have a literal Name (the backend accepts these too). */
  readonly declaredVariables = computed<FlowVariable[]>(() => {
    const found: FlowVariable[] = [];
    const walk = (list: FlowNode[]) => {
      for (const n of list) {
        if (n.pkg === 'Core' && n.fn === 'Variable.Create') {
          const name = (n.inputs['Name'] ?? '').trim();
          if (/^[A-Za-z_]\w*$/.test(name)) {
            found.push({
              name,
              type: (n.inputs['Type'] ?? '').trim().toUpperCase(), // '' = inferred from the value
              value: null,
              input: false,
              output: false,
            });
          }
        }
        for (const b of Object.keys(n.blocks)) walk(n.blocks[b]);
      }
    };
    walk(this.actions());
    return found;
  });

  /** Everything a picker may offer: designer variables plus the ones declared by Variable.Create. */
  readonly allVariables = computed<FlowVariable[]>(() => {
    const names = new Set(this.variables().map((v) => v.name.toLowerCase()));
    return [...this.variables(), ...this.declaredVariables().filter((d) => !names.has(d.name.toLowerCase()))];
  });

  /** Problems the backend would also reject; shown before uploading. */
  readonly problems = computed<string[]>(() => {
    const out: string[] = [];
    const known = new Map(this.allVariables().map((v) => [v.name.toLowerCase(), v]));
    const line = this.lineNumbers();

    const walk = (list: FlowNode[]) => {
      for (const n of list) {
        const at = `Action ${line.get(n.uid)} (${n.fn})`;
        const texts = [...Object.values(n.inputs)];
        if (n.condition) texts.push(n.condition.left, n.condition.right);
        for (const t of texts) {
          for (const m of (t ?? '').matchAll(TEMPLATE_REGEX)) {
            if (!known.has(m[1].toLowerCase())) out.push(`${at}: variable '${m[1]}' is not defined.`);
          }
        }
        for (const [key, name] of Object.entries(n.outputs)) {
          if (!name) continue;
          const v = known.get(name.toLowerCase());
          if (!v) {
            out.push(`${at}: output '${key}' uses undefined variable '${name}'.`);
            continue;
          }
          const expected = n.def?.outputs?.[key]?.toUpperCase();
          if (n.fn === 'ForEachRow' && (key === 'Item' || key === 'Index')) {
            const need = key === 'Item' ? 'ROW' : 'NUMBER';
            if (v.type && v.type !== need) out.push(`${at}: '${key}' must be stored in a ${need} variable ('${name}' is ${v.type}).`);
          } else if (expected === 'ROW' && v.type && v.type !== 'ROW') {
            out.push(`${at}: '${key}' must be stored in a ROW variable ('${name}' is ${v.type}).`);
          }
        }
        for (const b of Object.keys(n.blocks)) walk(n.blocks[b]);
      }
    };
    walk(this.actions());
    return [...new Set(out)];
  });

  readonly workflowJson = computed(() => this.buildWorkflow());
  readonly workflowText = computed(() => JSON.stringify(this.workflowJson(), null, 2));

  constructor() {
    this.loadVariableTypes();
    this.loadPackages();

    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('id');
      this.workflowId.set(id);
      if (id) this.loadWorkflow(id);
    });
  }

  // =====================================================================
  // Loading a saved workflow
  // =====================================================================
  loadWorkflow(id: string): void {
    this.workflowLoading.set(true);
    this.workflowError.set('');
    this.http
      .get(`${API_BASE}/Workflows/${encodeURIComponent(id)}`, {
        headers: { accept: '*/*' },
        responseType: 'text',
      })
      .subscribe({
        next: (text) => {
          try {
            this.pendingWorkflow = this.unwrapWorkflow(JSON.parse(text));
            this.applyPendingWorkflow();
          } catch (e) {
            this.workflowError.set(`Workflow ${id} could not be read: ${(e as Error).message}`);
          }
          this.workflowLoading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.workflowError.set(
            err.status === 404
              ? `Workflow ${id} was not found.`
              : `Could not load workflow ${id} (${err.status || 'network error'}).`,
          );
          this.workflowLoading.set(false);
        },
      });
  }

  private applyPendingWorkflow(): void {
    if (!this.pendingWorkflow || !this.packagesLoaded()) return; // wait for the catalog
    const json = this.pendingWorkflow;
    this.pendingWorkflow = null;
    try {
      this.applyWorkflowJson(json);
    } catch (e) {
      this.workflowError.set(`Workflow could not be opened: ${(e as Error).message}`);
    }
  }

  /** Accepts the workflow itself, a JSON string, or an envelope such as { id, name, json: {...} }. */
  private unwrapWorkflow(raw: any): any {
    if (typeof raw === 'string') return this.unwrapWorkflow(JSON.parse(raw));
    if (raw && typeof raw === 'object') {
      if (raw.Actions) return raw;
      for (const key of ['workflowJson', 'workflow', 'json', 'content', 'definition', 'data']) {
        if (raw[key]) return this.unwrapWorkflow(raw[key]);
      }
    }
    throw new Error("response has no 'Actions' object");
  }

  importWorkflow(): void {
    try {
      this.applyWorkflowJson(JSON.parse(this.importText()));
      this.importOpen.set(false);
    } catch (e) {
      this.importError.set(`Invalid workflow JSON: ${(e as Error).message}`);
    }
  }

  private applyWorkflowJson(json: any): void {
    const notes: string[] = [];
    const vars: FlowVariable[] = Object.entries<any>(json.variables ?? {}).map(([name, v]) => {
      const migrated = this.migrateVariable(name, v);
      if (migrated.note) notes.push(migrated.note);
      return migrated.variable;
    });

    const nodes = Object.entries<any>(json.Actions ?? {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, a]) => this.deserializeNode(a));

    this.flowName.set(json.flow_name ?? 'Imported flow');
    this.version.set(json.version ?? '1.0.0');
    this.variables.set(vars);
    this.actions.set(nodes);
    this.migrationNotes.set(notes);
    this.select(null);
  }

  /**
   * Older workflows used LIST / DICTIONARY / ANY (or an object describing a structure).
   * The engine now supports STRING, NUMBER, BOOLEAN, JSON, DATATABLE and ROW only, so these are converted.
   */
  private migrateVariable(name: string, v: any): { variable: FlowVariable; note?: string } {
    const declared = typeof v?.type === 'string' ? v.type.toUpperCase() : v?.type == null ? 'STRING' : 'OBJECT';
    let type = declared;
    let value = v?.value;
    let note: string | undefined;

    const isRecord = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);

    if (declared === 'LIST') {
      type = Array.isArray(value) && value.length > 0 && value.every(isRecord) ? 'DATATABLE' : 'JSON';
    } else if (declared === 'DICTIONARY' || declared === 'ANY' || declared === 'OBJECT') {
      type = 'JSON';
    }

    if (type !== declared) note = `'${name}': ${declared} → ${type}`;

    // an empty string is not a valid value for the structured types
    if (['JSON', 'ROW', 'DATATABLE'].includes(type) && value === '') value = null;

    return { variable: { name, type, value, input: !!v?.input, output: !!v?.output }, note };
  }

  // =====================================================================
  // Packages and variable types
  // =====================================================================
  loadPackages(): void {
    this.packagesLoading.set(true);
    this.packagesError.set('');
    this.http.get<PackageDef[]>(`${API_BASE}/Packages`, { params: { includeCore: true } }).subscribe({
      next: (pkgs) => {
        this.packages.set(pkgs ?? []);
        this.packagesLoading.set(false);
        this.packagesLoaded.set(true);
        this.applyPendingWorkflow();
      },
      error: (err: HttpErrorResponse) => {
        this.packagesError.set(`Could not load packages (${err.status || 'network error'}).`);
        this.packagesLoading.set(false);
        this.packagesLoaded.set(true);
        this.applyPendingWorkflow();
      },
    });
  }

  /** Loads the user-creatable variable types (GET /api/Core/variable-types); keeps the defaults if the call fails. */
  loadVariableTypes(): void {
    this.varTypesLoading.set(true);
    this.varTypesError.set('');
    this.http.get<VarTypeDef[]>(`${API_BASE}/Core/variable-types`).subscribe({
      next: (types) => {
        const list = (types ?? []).map((t) => ({
          name: String(t.name).toUpperCase(),
          description: t.description ?? '',
          example: t.example ?? null,
          structured: !!t.structured,
        }));
        if (list.length) this.varTypeDefs.set(list);
        this.varTypesLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.varTypesError.set(`Could not load variable types (${err.status || 'network error'}); showing defaults.`);
        this.varTypesLoading.set(false);
      },
    });
  }

  /** Description / example of a type, for the variable dialog. */
  varTypeInfo(type: string): VarTypeDef | null {
    const t = (type ?? '').toUpperCase();
    return this.varTypeDefs().find((d) => d.name === t) ?? null;
  }

  toggleGroup(name: string): void {
    this.collapsed.update((s) => {
      const next = new Set(s);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  isOpen(name: string): boolean {
    return !!this.paletteQuery().trim() || !this.collapsed().has(name);
  }

  // =====================================================================
  // Node helpers
  // =====================================================================
  private nextUid(): string {
    return `n${++this.uidSeq}`;
  }

  private newNode(pkg: string, fn: string, def: ActionDef | null): FlowNode {
    const node: FlowNode = {
      uid: this.nextUid(),
      pkg,
      fn,
      def,
      inputs: {},
      outputs: {},
      condition: null,
      blocks: {},
    };
    if (def) {
      for (const k of Object.keys(def.inputs ?? {})) node.inputs[k] = '';
      for (const k of Object.keys(def.outputs ?? {})) node.outputs[k] = '';
      if (def.hasCondition) {
        node.condition = { left: '', operator: def.conditionOperators?.[0] ?? 'Equals', right: '' };
      }
      for (const b of def.blocks ?? []) node.blocks[b] = [];
    }
    return node;
  }

  private locate(
    uid: string,
    list: FlowNode[] = this.actions(),
    owner: string | null = null,
    block = 'root',
  ): NodeLocation | null {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.uid === uid) return { node: n, list, index: i, owner, block };
      for (const b of Object.keys(n.blocks)) {
        const r = this.locate(uid, n.blocks[b], n.uid, b);
        if (r) return r;
      }
    }
    return null;
  }

  private findNode(uid: string): FlowNode | null {
    return this.locate(uid)?.node ?? null;
  }

  private listOf(owner: string | null, block: string): FlowNode[] | null {
    if (owner === null) return this.actions();
    return this.findNode(owner)?.blocks[block] ?? null;
  }

  private contains(node: FlowNode, uid: string): boolean {
    if (node.uid === uid) return true;
    return Object.values(node.blocks).some((l) => l.some((c) => this.contains(c, uid)));
  }

  private commit(): void {
    this.actions.update((a) => [...a]);
  }

  blockKeys(node: FlowNode): string[] {
    return Object.keys(node.blocks);
  }

  slotKey(owner: string | null, block: string, index: number): string {
    return `${owner ?? 'root'}|${block}|${index}`;
  }

  summary(n: FlowNode): string {
    if (n.condition) {
      const c = n.condition;
      return `${c.left} ${c.operator}${UNARY_OPERATORS.has(c.operator) ? '' : ' ' + c.right}`;
    }
    const ins = Object.entries(n.inputs)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${v}`);
    const outs = Object.entries(n.outputs)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} → ${v}`);
    return [...ins, ...outs].join('  ·  ');
  }

  needsRight(op: string): boolean {
    return !UNARY_OPERATORS.has(op);
  }

  // =====================================================================
  // Selection / add / delete / move
  // =====================================================================
  select(uid: string | null): void {
    this.selectedUid.set(uid);
  }

  addFromPalette(pkg: string, def: ActionDef): void {
    const node = this.newNode(pkg, def.name, def);
    const sel = this.selectedUid() ? this.locate(this.selectedUid()!) : null;
    if (sel) sel.list.splice(sel.index + 1, 0, node);
    else this.actions().push(node);
    this.commit();
    this.select(node.uid);
    this.openEditor(node);
  }

  deleteNode(uid: string): void {
    const loc = this.locate(uid);
    if (!loc) return;
    loc.list.splice(loc.index, 1);
    if (this.selectedUid() === uid) this.select(null);
    this.commit();
  }

  deleteSelected(): void {
    const uid = this.selectedUid();
    if (uid) this.deleteNode(uid);
  }

  moveBy(uid: string, delta: number): void {
    const loc = this.locate(uid);
    if (!loc) return;
    const target = loc.index + delta;
    if (target < 0 || target >= loc.list.length) return;
    [loc.list[loc.index], loc.list[target]] = [loc.list[target], loc.list[loc.index]];
    this.commit();
  }

  clearAll(): void {
    if (!confirm('Remove all actions and variables?')) return;
    this.actions.set([]);
    this.variables.set([]);
    this.migrationNotes.set([]);
    this.select(null);
  }

  // =====================================================================
  // Drag & drop (native HTML5)
  // =====================================================================
  onPaletteDragStart(e: DragEvent, pkg: string, def: ActionDef): void {
    this.payload = { kind: 'new', pkg, fn: def.name };
    e.dataTransfer?.setData('text/plain', def.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    this.dragging.set(true);
  }

  onNodeDragStart(e: DragEvent, node: FlowNode): void {
    this.payload = { kind: 'move', uid: node.uid };
    e.dataTransfer?.setData('text/plain', node.fn);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.dragging.set(true);
  }

  onDragEnd(): void {
    this.payload = null;
    this.dragging.set(false);
    this.dropKey.set(null);
  }

  private canDrop(owner: string | null): boolean {
    const p = this.payload;
    if (!p) return false;
    if (p.kind === 'new' || owner === null) return true;
    const moving = this.findNode(p.uid);
    return !!moving && !this.contains(moving, owner);
  }

  onSlotOver(e: DragEvent, owner: string | null, block: string, index: number): void {
    if (!this.canDrop(owner)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = this.payload?.kind === 'new' ? 'copy' : 'move';
    const key = this.slotKey(owner, block, index);
    if (this.dropKey() !== key) this.dropKey.set(key);
  }

  onSlotDrop(e: DragEvent, owner: string | null, block: string, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    const p = this.payload;
    if (p && this.canDrop(owner)) {
      const target = this.listOf(owner, block);
      if (target) {
        if (p.kind === 'new') {
          const def = this.catalog().get(`${p.pkg}.${p.fn}`)?.def ?? null;
          const node = this.newNode(p.pkg, p.fn, def);
          target.splice(index, 0, node);
          this.commit();
          this.select(node.uid);
          this.openEditor(node);
        } else {
          const loc = this.locate(p.uid);
          if (loc) {
            let idx = index;
            if (loc.list === target && loc.index < index) idx--;
            loc.list.splice(loc.index, 1);
            target.splice(idx, 0, loc.node);
            this.commit();
          }
        }
      }
    }
    this.onDragEnd();
  }

  // =====================================================================
  // Action editor dialog
  // =====================================================================
  openEditor(node: FlowNode): void {
    const hasContent =
      Object.keys(node.inputs).length || Object.keys(node.outputs).length || node.condition;
    if (!hasContent) return;
    const def = node.def;
    this.draft.set({
      node,
      inputFields: Object.keys(node.inputs).map((key) => ({
        key,
        type: def?.inputs?.[key] ?? 'ANY',
        long: /json|expression|message|value/i.test(key),
      })),
      outputFields: Object.keys(node.outputs).map((key) => ({ key, type: def?.outputs?.[key] ?? 'ANY' })),
      outputKeys: Object.keys(node.outputs),
      inputs: { ...node.inputs },
      outputs: { ...node.outputs },
      condition: node.condition ? { ...node.condition } : null,
      operators: def?.conditionOperators ?? [],
    });
  }

  saveEditor(): void {
    const d = this.draft();
    if (!d) return;
    d.node.inputs = d.inputs;
    d.node.outputs = d.outputs;
    d.node.condition = d.condition;
    this.commit();
    this.draft.set(null);
  }

  appendVar(target: any, key: string, name: string): void {
    if (!name) return;
    target[key] = (target[key] ?? '') + `{{${name}}}`;
  }

  /**
   * Variables offered for an action INPUT of the given type. A DATATABLE input takes DATATABLE (or JSON) variables,
   * a ROW input takes ROW (or JSON) variables; every other type accepts any variable (the engine converts).
   */
  varsForInput(inputType: string): FlowVariable[] {
    const t = (inputType ?? 'ANY').toUpperCase();
    const all = this.allVariables();
    return STRICT_TYPES.has(t) ? all.filter((v) => !v.type || v.type === t || v.type === 'JSON') : all;
  }

  /** Variables offered for an action OUTPUT: ROW and DATATABLE outputs must go to a variable of that exact type. */
  varsForOutput(outputType: string): FlowVariable[] {
    const t = (outputType ?? 'ANY').toUpperCase();
    const all = this.allVariables();
    return STRICT_TYPES.has(t) ? all.filter((v) => !v.type || v.type === t) : all;
  }

  // =====================================================================
  // Variables
  // =====================================================================
  newVariable(): void {
    this.varError.set('');
    this.varDraft.set({ editing: false, name: '', type: 'STRING', valueText: '', input: false, output: false });
  }

  /** Puts the type's example into the value box (button in the variable dialog). */
  useExample(): void {
    const d = this.varDraft();
    const example = d ? this.varTypeInfo(d.type)?.example : null;
    if (d && example) this.varDraft.set({ ...d, valueText: example });
  }

  editVariable(v: FlowVariable): void {
    this.varError.set('');
    this.varDraft.set({
      editing: true,
      name: v.name,
      type: v.type,
      valueText: this.valueToText(v.value),
      input: v.input,
      output: v.output,
    });
  }

  saveVariable(): void {
    const d = this.varDraft();
    if (!d) return;
    const name = d.name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      this.varError.set('Name must start with a letter or underscore and contain only letters, digits or _.');
      return;
    }
    if (!d.editing && this.variables().some((v) => v.name.toLowerCase() === name.toLowerCase())) {
      this.varError.set(`A variable named "${name}" already exists.`);
      return;
    }
    let value: unknown;
    try {
      value = this.parseVarValue(d.valueText, d.type);
    } catch (e) {
      this.varError.set((e as Error).message);
      return;
    }
    const variable: FlowVariable = { name, type: d.type, value, input: d.input, output: d.output };
    this.variables.update((list) =>
      d.editing ? list.map((v) => (v.name === name ? variable : v)) : [...list, variable],
    );
    this.varDraft.set(null);
  }

  deleteVariable(name: string): void {
    if (this.isVariableUsed(name) && !confirm(`"${name}" is used in the flow. Delete it anyway?`)) return;
    this.variables.update((list) => list.filter((v) => v.name !== name));
  }

  /** Short text for the variable list; tables show their size instead of every row. */
  displayValue(v: FlowVariable): string {
    if (v.value === null || v.value === undefined) return '';
    if (v.type === 'DATATABLE') {
      const rows = Array.isArray(v.value) ? v.value : ((v.value as any)?.rows ?? []);
      return `${rows.length} row${rows.length === 1 ? '' : 's'}`;
    }
    return this.valueToText(v.value);
  }

  /** Hint text for the value box of the variable dialog (the type's example from the backend). */
  valueHint(type: string): string {
    const info = this.varTypeInfo(type);
    if (!info) return '';
    if (info.structured) return `e.g. ${info.example ?? ''}`;
    if ((type ?? '').toUpperCase() === 'BOOLEAN') return 'true or false';
    return info.example ? `e.g. ${info.example}` : info.description;
  }

  /** True for types whose value is JSON and should use a multi-line box. */
  isStructuredType(type: string): boolean {
    return this.varTypeInfo(type)?.structured ?? false;
  }

  private valueToText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, this.isObject(value) ? 2 : 0);
  }

  private isObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
  }

  private isVariableUsed(name: string): boolean {
    const used = new Set<string>();
    const text = JSON.stringify(this.actions().map((n) => this.serializeNode(n, used)));
    return text.includes(`{{${name}`);
  }

  private parseJsonText(text: string, what: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${what} must be valid JSON.`);
    }
  }

  /** Turns the text typed in the variable dialog into the value stored in the workflow JSON. */
  private parseVarValue(text: string, type: VarType): unknown {
    const t = text.trim();
    switch ((type ?? '').toUpperCase()) {
      case 'STRING':
        return text;

      case 'NUMBER': {
        if (t === '') return 0;
        const n = Number(t);
        if (Number.isNaN(n)) throw new Error('Value is not a valid number.');
        return n;
      }

      case 'BOOLEAN': {
        const l = t.toLowerCase();
        if (l !== '' && l !== 'true' && l !== 'false' && l !== '1' && l !== '0') {
          throw new Error('Value must be true or false.');
        }
        return l === 'true' || l === '1';
      }

      case 'JSON':
        return t === '' ? null : this.parseJsonText(t, 'JSON value');

      case 'DATATABLE': {
        if (t === '') return null;
        const parsed = this.parseJsonText(t, 'Table value');
        const isRecord = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
        const arrayOfObjects = Array.isArray(parsed) && parsed.every(isRecord);
        const headersRows =
          isRecord(parsed) &&
          Array.isArray((parsed as any).headers) &&
          ((parsed as any).rows === undefined || Array.isArray((parsed as any).rows));
        if (!arrayOfObjects && !headersRows) {
          throw new Error('Table value must be an array of objects or {"headers": [...], "rows": [...]}.');
        }
        return parsed;
      }

      case 'ROW': {
        if (t === '') return null;
        const parsed = this.parseJsonText(t, 'Row value');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Row value must be a single JSON object.');
        }
        return parsed;
      }

      default:
        // types added by backend contributors (e.g. GUID): keep JSON when it parses, otherwise the text
        try {
          return JSON.parse(t);
        } catch {
          return text;
        }
    }
  }

  // =====================================================================
  // Serialisation  (designer model -> workflow JSON)
  // =====================================================================
  private coerce(text: string, type: string): unknown {
    const t = (type ?? 'ANY').toUpperCase();
    const s = text ?? '';
    if (NUMERIC_TYPES.includes(t)) {
      if (s.trim() === '') return undefined;
      return /^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : s;
    }
    if (t === 'BOOL' || t === 'BOOLEAN') {
      const l = s.trim().toLowerCase();
      if (l === '') return undefined;
      return l === 'true' ? true : l === 'false' ? false : s;
    }
    if (t === 'STRING') return s;
    // ANY / JSON / DATATABLE / ROW: a {{variable}} stays text, literal JSON is parsed
    return this.coerceAny(s);
  }

  private coerceAny(s: string): unknown {
    const x = s.trim();
    if (x === '') return s;
    if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x);
    if (x === 'true') return true;
    if (x === 'false') return false;
    if (/^[\[{]/.test(x)) {
      try {
        return JSON.parse(x);
      } catch {
        /* keep as string (e.g. {{var}}) */
      }
    }
    return s;
  }

  private serializeNode(n: FlowNode, usedPackages: Set<string>): Record<string, unknown> {
    if (n.pkg !== 'Core') usedPackages.add(n.pkg);

    const Inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n.inputs)) {
      const val = this.coerce(v, n.def?.inputs?.[k] ?? 'ANY');
      if (val !== undefined) Inputs[k] = val;
    }
    const Outputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.outputs)) {
      if (v) Outputs[k] = `{{${v}}}`;
    }

    const out: Record<string, unknown> = { ClassName: n.pkg, FunctionName: n.fn, Inputs, Outputs };

    if (n.condition) {
      const c = n.condition;
      const cond: Record<string, unknown> = { Left: this.coerceAny(c.left), Operator: c.operator };
      if (this.needsRight(c.operator)) cond['Right'] = this.coerceAny(c.right);
      out['Condition'] = cond;
    }
    for (const b of Object.keys(n.blocks)) {
      out[b] = n.blocks[b].map((c) => this.serializeNode(c, usedPackages));
    }
    return out;
  }

  private buildWorkflow(): Record<string, unknown> {
    const used = new Set<string>();
    const Actions: Record<string, unknown> = {};
    this.actions().forEach((n, i) => (Actions[String(i + 1)] = this.serializeNode(n, used)));

    const packages: Record<string, string> = {};
    for (const name of used) {
      const fp = this.packages().find((p) => p.name === name && !p.isBuiltIn)?.filePath;
      if (fp) packages[name] = fp;
    }

    // Only designer variables are written; Variable.Create variables are created by the engine at run time.
    const variables: Record<string, unknown> = {};
    for (const v of this.variables()) {
      variables[v.name] = { value: v.value, type: v.type, input: v.input, output: v.output };
    }

    return {
      flow_name: this.flowName(),
      version: this.version(),
      packages,
      variables,
      Actions,
    };
  }

  // =====================================================================
  // Import  (workflow JSON -> designer model)
  // =====================================================================
  openImport(): void {
    this.importText.set('');
    this.importError.set('');
    this.importOpen.set(true);
  }

  goback(): void {
    window.history.back();
  }

  private toText(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  private deserializeNode(a: any): FlowNode {
    const pkg: string = a.ClassName;
    const fn: string = a.FunctionName;
    const def = this.catalog().get(`${pkg}.${fn}`)?.def ?? null;
    const node = this.newNode(pkg, fn, def);

    for (const [k, v] of Object.entries(a.Inputs ?? {})) node.inputs[k] = this.toText(v);
    for (const [k, v] of Object.entries(a.Outputs ?? {})) {
      node.outputs[k] = String(v).replace(/^\{\{\s*|\s*\}\}$/g, '');
    }
    if (a.Condition) {
      node.condition = {
        left: this.toText(a.Condition.Left),
        operator: a.Condition.Operator ?? 'Equals',
        right: this.toText(a.Condition.Right),
      };
    }
    const blockNames = new Set<string>([
      ...(def?.blocks ?? []),
      ...KNOWN_BLOCKS.filter((k) => Array.isArray(a[k])),
    ]);
    for (const b of blockNames) {
      node.blocks[b] = ((a[b] ?? []) as any[]).map((c) => this.deserializeNode(c));
    }
    return node;
  }

  // =====================================================================
  // JSON preview / upload
  // =====================================================================
  copyJson(): void {
    navigator.clipboard?.writeText(this.workflowText());
  }

  upload(): void {
    this.uploading.set(true);
    this.uploadResult.set(null);

    // Send the workflow as a plain JSON object (Angular serialises it and sets application/json).
    this.http
      .post(`${API_BASE}/Workflows/upload`, this.workflowJson(), {
        headers: { accept: '*/*' },
        responseType: 'text',
      })
      .subscribe({
        next: (res) => {
          this.uploadResult.set({ ok: true, body: this.pretty(res) });
          this.uploading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          const detail = typeof err.error === 'string' ? err.error : err.message;
          this.uploadResult.set({ ok: false, body: `${err.status || ''} ${this.pretty(detail)}`.trim() });
          this.uploading.set(false);
        },
      });
  }

  private pretty(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
}
