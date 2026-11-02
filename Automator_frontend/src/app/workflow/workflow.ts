import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';


const API_BASE = 'https://localhost:5001/api';
const VAR_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'LIST', 'ANY'] as const;
type VarType = (typeof VAR_TYPES)[number];
const UNARY_OPERATORS = new Set(['IsEmpty', 'IsNotEmpty', 'IsNull', 'IsNotNull', 'IsTrue', 'IsFalse']);
const NUMERIC_TYPES = ['NUMBER', 'INT', 'INTEGER', 'LONG', 'DOUBLE', 'FLOAT', 'DECIMAL'];
const KNOWN_BLOCKS = ['Then', 'Else', 'Body', 'Catch'];

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

interface Location {
  node: FlowNode;
  list: FlowNode[];
  index: number;
  owner: string | null;
  block: string;
}

interface ActionDraft {
  node: FlowNode;
  inputFields: { key: string; type: string; long: boolean }[];
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
  private uidSeq = 0;
  private payload: DragPayload | null = null;
private readonly route = inject(ActivatedRoute);
private pendingWorkflow: any = null;

readonly workflowId = signal<string | null>(null);
readonly workflowLoading = signal(false);
readonly workflowError = signal('');
readonly packagesLoaded = signal(false);
  readonly varTypes = VAR_TYPES;

  // ---- state ----
  readonly flowName = signal('Core Actions Demo');
  readonly version = signal('1.0.0');
  readonly packages = signal<PackageDef[]>([]);
  readonly packagesLoading = signal(false);
  readonly packagesError = signal('');

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

  readonly workflowJson = computed(() => this.buildWorkflow());
  readonly workflowText = computed(() => JSON.stringify(this.workflowJson(), null, 2));

  constructor() {
    this.loadPackages();

     this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
    const id = params.get('id');
    this.workflowId.set(id);
    if (id) this.loadWorkflow(id);
  });
  }
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
          err.status === 404 ? `Workflow ${id} was not found.` : `Could not load workflow ${id} (${err.status || 'network error'}).`,
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
  const vars: FlowVariable[] = Object.entries<any>(json.variables ?? {}).map(([name, v]) => ({
    name,
    type: (v.type ?? 'ANY') as VarType,
    value: v.value,
    input: !!v.input,
    output: !!v.output,
  }));
  const nodes = Object.entries<any>(json.Actions ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, a]) => this.deserializeNode(a));

  this.flowName.set(json.flow_name ?? 'Imported flow');
  this.version.set(json.version ?? '1.0.0');
  this.variables.set(vars);
  this.actions.set(nodes);
  this.select(null);
}
  // =====================================================================
  // Packages
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
  ): Location | null {
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
        long: /json|expression|message/i.test(key),
      })),
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

  // =====================================================================
  // Variables
  // =====================================================================
  newVariable(): void {
    this.varError.set('');
    this.varDraft.set({ editing: false, name: '', type: 'STRING', valueText: '', input: false, output: false });
  }

  editVariable(v: FlowVariable): void {
    this.varError.set('');
    this.varDraft.set({
      editing: true,
      name: v.name,
      type: v.type,
      valueText: typeof v.value === 'string' ? v.value : JSON.stringify(v.value),
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
    if (!d.editing && this.variables().some((v) => v.name === name)) {
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

  displayValue(v: FlowVariable): string {
    return typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
  }

  private isVariableUsed(name: string): boolean {
    const used = new Set<string>();
    const text = JSON.stringify(this.actions().map((n) => this.serializeNode(n, used)));
    return text.includes(`{{${name}`);
  }

  private parseVarValue(text: string, type: VarType): unknown {
    const t = text.trim();
    switch (type) {
      case 'STRING':
        return text;
      case 'NUMBER': {
        if (t === '') return 0;
        const n = Number(t);
        if (Number.isNaN(n)) throw new Error('Value is not a valid number.');
        return n;
      }
      case 'BOOLEAN':
        return t.toLowerCase() === 'true';
      case 'LIST': {
        if (t === '') return [];
        let parsed: unknown;
        try {
          parsed = JSON.parse(t);
        } catch {
          throw new Error('List value must be valid JSON, e.g. [1, 2, 3].');
        }
        if (!Array.isArray(parsed)) throw new Error('List value must be a JSON array.');
        return parsed;
      }
      default:
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
  // importWorkflow(): void {
  //   try {
  //     const json = JSON.parse(this.importText());
  //     const vars: FlowVariable[] = Object.entries<any>(json.variables ?? {}).map(([name, v]) => ({
  //       name,
  //       type: (v.type ?? 'ANY') as VarType,
  //       value: v.value,
  //       input: !!v.input,
  //       output: !!v.output,
  //     }));
  //     const nodes = Object.entries<any>(json.Actions ?? {})
  //       .sort((a, b) => Number(a[0]) - Number(b[0]))
  //       .map(([, a]) => this.deserializeNode(a));

  //     this.flowName.set(json.flow_name ?? 'Imported flow');
  //     this.version.set(json.version ?? '1.0.0');
  //     this.variables.set(vars);
  //     this.actions.set(nodes);
  //     this.select(null);
  //     this.importOpen.set(false);
  //   } catch (e) {
  //     this.importError.set(`Invalid workflow JSON: ${(e as Error).message}`);
  //   }
  // }

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
