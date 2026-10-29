import { Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild, OnInit } from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment.development';

// Tip: use a dev proxy (proxy.conf.json: "/api" -> https://localhost:5000, secure:false)
// and set this to '/api/Packages' to avoid CORS / self-signed cert issues.

const baseUrl = `${environment.apiUrl}`;
const API_URL = `${baseUrl}/api/Packages`;
const WORKFLOWS_URL = `${baseUrl}/api/Workflows`;           // NEW: GET {WORKFLOWS_URL}/{id}
const WORKFLOW_UPLOAD_URL = `${WORKFLOWS_URL}/upload`;

// ───────────────────────────── Models ─────────────────────────────
export interface PackageAction {
  id: number;
  packageId: number;
  name: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export interface BotPackage {
  id: number;
  name: string;
  version: string;
  filePath: string;
  dependencies: string[];
  actions: PackageAction[];
  className?: string;
}

/** literal = typed value, variable = {{variableName}} reference */
export interface Binding {
  mode: 'literal' | 'variable';
  value: string;     // literal text OR the variable name
  varValue: string;  // initial value of the variable (only used if the variable is NOT declared in the Variables pane)
}

export type WorkflowBranch = 'Body' | 'Catch' | 'Then' | 'Else';

export interface WorkflowCondition {
  Left: unknown;
  Operator: string;
  Right: unknown;
}

export interface FlowNode {
  id: number;
  x: number;
  y: number;
  pkg: BotPackage;
  action: PackageAction;
  inputs: Record<string, Binding>;
  outputs: Record<string, string>; // output name -> variable name

  /** Set for actions nested inside TryCatch/If blocks. */
  parentId?: number | null;
  branch?: WorkflowBranch | null;
  /** Used by Core.If. */
  condition?: WorkflowCondition;
}

export interface Connection {
  id: number;
  from: number;
  to: number;
}

export type VarType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'LIST' | 'ANY';

/** A variable declared by the user in the Variables pane. */
export interface FlowVariable {
  name: string;
  type: VarType;
  value: string; // initial value, kept as text and coerced on generation
}

export interface VarSuggestion {
  name: string;
  type: string;
  source: 'declared' | 'output';
}

// Shape used by saved workflow JSON. Both Outputs and legacy outputs are accepted.
export interface WorkflowStep {
  ClassName: string;
  FunctionName: string;
  Inputs?: Record<string, unknown>;
  Outputs?: Record<string, string>;
  outputs?: Record<string, string>;
  Body?: WorkflowStep[];
  Catch?: WorkflowStep[];
  Condition?: WorkflowCondition;
  Then?: WorkflowStep[];
  Else?: WorkflowStep[];
}

export interface WorkflowDefinition {
  flow_name: string;
  version: string;
  packages?: Record<string, string>;
  variables?: Record<string, { value: unknown; type: string; input: boolean; output: boolean }>;
  Actions?: Record<string, WorkflowStep>;
}

export interface WorkflowRecord {
  id: number;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
  workflow: WorkflowDefinition;
}

// ───────────────────────── Workflow generator ─────────────────────────

const CLASS_NAMES: Record<string, string> = {
  ExcelOperations: 'ExcelTools.ExcelReader',
  'REST API': 'REST_API.RestClient',
};

export const mapType = (t: string): string => {
  switch (t.toLowerCase()) {
    case 'string': return 'STRING';
    case 'bool': case 'boolean': return 'BOOLEAN';
    case 'int': case 'long': case 'double': case 'float': case 'decimal': case 'number': return 'NUMBER';
    default: return t.toUpperCase();
  }
};

export const defaultFor = (t: string): unknown => {
  const m = mapType(t);
  if (m === 'NUMBER') return 0;
  if (m === 'BOOLEAN') return false;
  if (m === 'LIST') return [];
  if (m === 'ANY') return null;
  return '';
};

export const defaultLiteral = (t: string): string => {
  const m = mapType(t);
  if (m === 'NUMBER') return '0';
  if (m === 'BOOLEAN') return 'false';
  if (m === 'LIST') return '[]';
  return '';
};

const coerce = (v: string, t: string): unknown => {
  const m = mapType(t);
  if (m === 'BOOLEAN') return v.toLowerCase() === 'true';
  if (m === 'NUMBER') { const n = Number(v); return v.trim() === '' || isNaN(n) ? 0 : n; }
  if (m === 'LIST' || m === 'ANY') {
    if (!v.trim()) return m === 'LIST' ? [] : null;
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
};

export const varName = (s: string) => s.trim().replace(/[^\w]/g, '_');

/** RestClient deserializes these inputs as Dictionary<string,string> JSON, so plain "key: value" lines are converted. */
const JSON_DICT_INPUTS = new Set(['headersJson', 'parametersJson']);
const toJsonDict = (v: string): string => {
  const t = v.trim();
  if (!t) return '';
  try { JSON.parse(t); return v; } catch { /* not JSON, convert below */ }
  const obj: Record<string, string> = {};
  t.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^:=]+?)\s*[:=]\s*(.*)$/);
    if (m) obj[m[1]] = m[2].trim();
  });
  return Object.keys(obj).length ? JSON.stringify(obj) : v;
};

/** Topological order (Kahn); ties broken top-to-bottom, left-to-right. */
export function sortNodes(nodes: FlowNode[], conns: Connection[]): FlowNode[] {
  const indeg = new Map(nodes.map(n => [n.id, 0] as [number, number]));
  conns.forEach(c => indeg.set(c.to, (indeg.get(c.to) ?? 0) + 1));
  const byPos = (a: FlowNode, b: FlowNode) => a.y - b.y || a.x - b.x;
  const ready = nodes.filter(n => !indeg.get(n.id)).sort(byPos);
  const out: FlowNode[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const c of conns.filter(c => c.from === n.id)) {
      const d = indeg.get(c.to)! - 1;
      indeg.set(c.to, d);
      if (d === 0) { ready.push(nodes.find(x => x.id === c.to)!); ready.sort(byPos); }
    }
  }
  return out;
}

export function generateWorkflow(
  name: string,
  version: string,
  nodes: FlowNode[],
  conns: Connection[],
  declared: FlowVariable[] = [],
) {
  const packages: Record<string, string> = {};
  const variables: Record<string, any> = {};
  const actions: Record<string, any> = {};

  // Include nested actions when calculating output variables and package references.
  const produced = new Set<string>();
  for (const n of nodes) {
    for (const value of Object.values(n.outputs)) {
      if (value.trim()) produced.add(varName(value));
    }

    const cls = n.pkg.className ?? CLASS_NAMES[n.pkg.name] ?? n.pkg.name.replace(/\s+/g, '');
    // Core control-flow actions are built into the runner and are not package DLLs.
    if (cls !== 'Core' && !cls.startsWith('Core.')) packages[n.pkg.name] = '';
  }

  // 1) Variables created in the Variables pane always go into the JSON.
  declared.forEach(d => {
    const v = varName(d.name);
    if (!v) return;
    variables[v] = {
      value: d.value === '' ? defaultFor(d.type) : coerce(d.value, d.type),
      type: mapType(d.type),
      input: !produced.has(v),
      output: produced.has(v),
    };
  });

  const siblings = (parentId: number | null, branch?: WorkflowBranch): FlowNode[] => {
    const list = nodes.filter(n => (n.parentId ?? null) === parentId && (parentId === null || n.branch === branch));
    if (!list.length) return [];
    const ids = new Set(list.map(n => n.id));
    const siblingConnections = conns.filter(c => ids.has(c.from) && ids.has(c.to));
    return sortNodes(list, siblingConnections);
  };

  const isTryCatch = (n: FlowNode) => n.action.name.toLowerCase() === 'trycatch';
  const isIf = (n: FlowNode) => n.action.name.toLowerCase() === 'if';

  const serializeNode = (n: FlowNode): any => {
    const inputs: Record<string, any> = {};
    // Include keys present in either the package metadata or a loaded workflow.
    const inputKeys = new Set([...Object.keys(n.action.inputs ?? {}), ...Object.keys(n.inputs ?? {})]);
    for (const key of inputKeys) {
      const type = n.action.inputs?.[key] ?? 'STRING';
      const b = n.inputs[key] ?? { mode: 'literal' as const, value: defaultLiteral(type), varValue: '' };
      if (b.mode === 'variable' && b.value.trim()) {
        const v = varName(b.value);
        inputs[key] = `{{${v}}}`;
        if (!variables[v]) {
          variables[v] = {
            value: b.varValue === '' ? defaultFor(type) : coerce(b.varValue, type),
            type: mapType(type),
            input: !produced.has(v),
            output: produced.has(v),
          };
        }
      } else {
        inputs[key] = JSON_DICT_INPUTS.has(key) ? toJsonDict(b.value) : coerce(b.value, type);
      }
    }

    const outputBindings: Record<string, string> = {};
    const outputKeys = new Set([...Object.keys(n.action.outputs ?? {}), ...Object.keys(n.outputs ?? {})]);
    for (const key of outputKeys) {
      const type = n.action.outputs?.[key] ?? 'STRING';
      const v = varName(n.outputs[key] || `${n.action.name}_${key}_${n.id}`);
      outputBindings[key] = `{{${v}}}`;
      if (variables[v]) {
        variables[v].output = true;
      } else {
        variables[v] = { value: defaultFor(type), type: mapType(type), input: false, output: true };
      }
    }

    const cls = n.pkg.className ?? CLASS_NAMES[n.pkg.name] ?? n.pkg.name.replace(/\s+/g, '');
    const step: any = {
      ClassName: cls,
      FunctionName: n.action.name,
      Inputs: inputs,
      Outputs: outputBindings,
    };

    const actionName = n.action.name.toLowerCase();
    if (actionName === 'trycatch') {
      step.Body = siblings(n.id, 'Body').map(serializeNode);
      step.Catch = siblings(n.id, 'Catch').map(serializeNode);
    } else if (actionName === 'if') {
      step.Condition = n.condition ?? { Left: '', Operator: 'Equals', Right: '' };
      step.Then = siblings(n.id, 'Then').map(serializeNode);
      step.Else = siblings(n.id, 'Else').map(serializeNode);
    } else if (['foreach', 'forcount', 'while', 'loop'].includes(actionName)) {
      step.Body = siblings(n.id, 'Body').map(serializeNode);
      if (actionName === 'while') step.Condition = n.condition ?? { Left: '', Operator: 'LessThan', Right: 0 };
    }

    return step;
  };

  // Actions in the top-level Actions object; nested steps are emitted under Body/Catch/Then/Else.
  siblings(null).forEach((n, index) => {
    actions[String(index + 1)] = serializeNode(n);
  });

  return { flow_name: name, version, packages, variables, Actions: actions };
}

// ───────────────────────────── Component ─────────────────────────────

@Component({
  selector: 'app-flow-builder',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet,CommonModule],
  templateUrl: './flow-builder.html',
  styleUrl: './flow-builder.css',
})
export class FlowBuilderComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);          // NEW
  private destroyRef = inject(DestroyRef);         // NEW
  private surface = viewChild.required<ElementRef<HTMLElement>>('surface');
readonly literalVariableToken = '{{myVar}}';
  readonly NODE_W = 220;
  readonly NODE_H = 72;                            // NEW: must match the card height in the template
  readonly mapType = mapType;
  readonly VAR_TYPES: VarType[] = ['STRING', 'NUMBER', 'BOOLEAN'];

  // ---- UI state
  submitting = signal(false);
  submitMessage = signal('');
  submitSuccess = signal(false);
  libraryOpen = signal(true);
  panelOpen = signal(true);
  zoom = signal(1);
  workflowId = signal<number | null>(null);        // NEW

  zoomIn() { this.zoom.update(z => Math.min(2, +(z + 0.1).toFixed(2))); }
  zoomOut() { this.zoom.update(z => Math.max(0.4, +(z - 0.1).toFixed(2))); }
  fit() { this.zoom.set(1); }
  back() { history.back(); }

  private readonly ACCENTS = ['#0f62d6', '#107c41', '#7a3fb0', '#c4562b', '#0b7a8c'];
  accentOf(pkgId: string | number): string {
    const s = String(pkgId);
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return this.ACCENTS[h % this.ACCENTS.length];
  }

  // ---- data
  packages = signal<BotPackage[]>([]);
  loading = signal(true);
  error = signal('');
  search = signal('');
  flowName = signal('My Flow');
  flowVersion = signal('1.0.0');
  nodes = signal<FlowNode[]>([]);
  connections = signal<Connection[]>([]);
  selectedId = signal<number | null>(null);
  tab = signal<'props' | 'vars' | 'json'>('props');
  pending = signal<{ from: number; x: number; y: number } | null>(null);
  copied = signal(false);

  // ---- package groups (all collapsed initially)
  expanded = signal<Set<number>>(new Set());

  /** Groups are open when the user expanded them, or automatically while searching. */
  isExpanded(id: number): boolean {
    return this.search().trim() !== '' || this.expanded().has(id);
  }
  toggleGroup(e: Event, id: number) {
    e.preventDefault(); // we control the open state ourselves
    if (this.search().trim()) return;
    this.expanded.update(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ---- variables pane
  variables = signal<FlowVariable[]>([]);
  newVarName = signal('');
  newVarType = signal<VarType>('STRING');
  newVarValue = signal('');
  varError = signal('');

  onNewVarTypeChange(t: VarType) {
    this.newVarType.set(t);
    this.newVarValue.set(defaultLiteral(t));
  }

  addVariable() {
    const name = varName(this.newVarName());
    if (!name) { this.varError.set('Variable name is required.'); return; }
    if (this.variables().some(v => v.name.toLowerCase() === name.toLowerCase())) {
      this.varError.set(`Variable '${name}' already exists.`);
      return;
    }
    this.variables.update(list => [
      ...list,
      { name, type: this.newVarType(), value: this.newVarValue() },
    ]);
    this.newVarName.set('');
    this.newVarValue.set(defaultLiteral(this.newVarType()));
    this.varError.set('');
  }

  updateVariable(name: string, field: 'type' | 'value', value: string) {
    this.variables.update(list => list.map(v => {
      if (v.name !== name) return v;
      return field === 'type'
        ? { ...v, type: value as VarType, value: defaultLiteral(value) }
        : { ...v, value };
    }));
  }

  removeVariable(name: string) {
    this.variables.update(list => list.filter(v => v.name !== name));
  }

  isDeclared(name: string): boolean {
    const n = varName(name);
    return !!n && this.variables().some(v => v.name === n);
  }

  /** Declared variables + output variables produced by nodes on the canvas. */
  suggestions = computed<VarSuggestion[]>(() => {
    const map = new Map<string, VarSuggestion>();
    this.variables().forEach(v => map.set(v.name, { name: v.name, type: v.type, source: 'declared' }));
    this.nodes().forEach(n =>
      Object.entries(n.action.outputs).forEach(([k, t]) => {
        const name = varName(n.outputs[k] ?? '');
        if (name && !map.has(name)) map.set(name, { name, type: mapType(String(t)), source: 'output' });
      }),
    );
    return [...map.values()];
  });

  /** Suggestions whose type matches the field's type. */
  suggestionsFor(type: string): VarSuggestion[] {
    const m = mapType(type);
    return this.suggestions().filter(s => s.type === m);
  }

  // ---- computed
  groups = computed(() => {
    const q = this.search().toLowerCase().trim();
    return this.packages()
      .map(pkg => ({ pkg, actions: pkg.actions.filter(a => !q || a.name.toLowerCase().includes(q) || pkg.name.toLowerCase().includes(q)) }))
      .filter(g => g.actions.length);
  });
  selected = computed(() => this.nodes().find(n => n.id === this.selectedId()) ?? null);
  order = computed(() => sortNodes(this.nodes(), this.connections()).map(n => n.id));
  json = computed(() =>
    JSON.stringify(
      generateWorkflow(this.flowName(), this.flowVersion(), this.nodes(), this.connections(), this.variables()),
      null,
      2,
    ),
  );

  private seq = 1;
  private dragging: { n: FlowNode; dx: number; dy: number } | null = null;

  // ───────── NEW: load packages (+ workflow when the route has :id) ─────────
  ngOnInit() {
    this.route.paramMap.pipe(
      map(p => Number(p.get('id')) || null),
      tap(id => {
        this.workflowId.set(id);
        this.loading.set(true);
        this.error.set('');
        this.submitMessage.set('');
      }),
      switchMap(id => forkJoin({
        packages: this.http.get<BotPackage[]>(API_URL),
        record: id === null
          ? of(null)
          : this.http.get<WorkflowRecord>(`${WORKFLOWS_URL}/${id}`).pipe(
              catchError(e => {
                this.error.set(e.status === 404
                  ? `Workflow ${id} was not found.`
                  : 'Could not load workflow: ' + (e.message ?? e.statusText));
                return of(null);
              }),
            ),
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ packages, record }) => {
        this.packages.set(this.withCoreActions(packages)); // add built-in control-flow actions before loading nested JSON
        if (record) this.loadWorkflow(record);
        else this.resetCanvas();
        this.loading.set(false);
      },
      error: e => {
        this.error.set('Could not load packages: ' + (e.message ?? e.statusText));
        this.loading.set(false);
      },
    });
  }

  private resetCanvas() {
    this.nodes.set([]);
    this.connections.set([]);
    this.variables.set([]);
    this.selectedId.set(null);
    this.seq = 1;
  }

  /** Ensure core control-flow actions exist even when they are not stored in the package library API. */
  private withCoreActions(packages: BotPackage[]): BotPackage[] {
    const builtIns: PackageAction[] = [
      { id: -1, packageId: -100, name: 'TryCatch', inputs: {}, outputs: { Error: 'STRING' } },
      { id: -2, packageId: -100, name: 'SetVariable', inputs: { Value: 'ANY' }, outputs: { Response: 'ANY' } },
      { id: -3, packageId: -100, name: 'If', inputs: {}, outputs: {} },
      { id: -4, packageId: -100, name: 'Evaluate', inputs: { Expression: 'STRING' }, outputs: { Response: 'ANY' } },
      { id: -5, packageId: -100, name: 'ForEach', inputs: { Collection: 'LIST' }, outputs: { Item: 'ANY', Index: 'NUMBER' } },
      { id: -6, packageId: -100, name: 'ForCount', inputs: { From: 'NUMBER', To: 'NUMBER', Step: 'NUMBER' }, outputs: { Index: 'NUMBER' } },
      { id: -7, packageId: -100, name: 'While', inputs: {}, outputs: {} },
      { id: -8, packageId: -100, name: 'Break', inputs: {}, outputs: {} },
      { id: -9, packageId: -100, name: 'Continue', inputs: {}, outputs: {} },
      { id: -10, packageId: -100, name: 'Return', inputs: {}, outputs: {} },
      { id: -11, packageId: -100, name: 'Loop', inputs: {}, outputs: {} },
    ];

    const coreIndex = packages.findIndex(p => p.className === 'Core' || p.name.replace(/\s+/g, '') === 'Core');
    if (coreIndex < 0) {
      return [...packages, {
        id: -100, name: 'Core', version: '1.0.0', filePath: '', dependencies: [],
        className: 'Core', actions: builtIns,
      }];
    }

    const core = packages[coreIndex];
    const actions = [...(core.actions ?? [])];
    for (const builtin of builtIns) {
      if (!actions.some(a => a.name.toLowerCase() === builtin.name.toLowerCase())) {
        actions.push({ ...builtin, packageId: core.id });
      }
    }
    return packages.map((p, i) => i === coreIndex ? { ...p, className: p.className ?? 'Core', actions } : p);
  }

  private findPackage(className: string): BotPackage | undefined {
    return this.packages().find(p =>
      p.className === className ||
      CLASS_NAMES[p.name] === className ||
      p.name.replace(/\s+/g, '') === className,
    );
  }

  /** "{{name}}" -> "name"; anything else -> null (it is a literal). */
  private unwrapVar(v: unknown): string | null {
    const m = /^\{\{\s*(.+?)\s*\}\}$/.exec(typeof v === 'string' ? v : '');
    return m ? m[1] : null;
  }

  /** Rebuild the canvas from a saved workflow record, including nested control-flow branches. */
  private loadWorkflow(rec: WorkflowRecord) {
    const wf = rec.workflow;
    this.resetCanvas();
    this.flowName.set(wf.flow_name ?? rec.name);
    this.flowVersion.set(wf.version ?? rec.version);

    const rootSteps = Object.entries(wf.Actions ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, step]) => step);
    const nodes: FlowNode[] = [];
    const conns: Connection[] = [];
    const missing: string[] = [];

    const loadSteps = (
      steps: WorkflowStep[],
      parentId: number | null = null,
      branch?: WorkflowBranch,
      depth = 0,
    ): void => {
      const siblingIds: number[] = [];

      for (const step of steps) {
        const pkg = this.findPackage(step.ClassName);
        const action = pkg?.actions.find(a => a.name === step.FunctionName);
        if (!pkg || !action) {
          missing.push(`${step.ClassName}.${step.FunctionName}`);
          continue;
        }

        const id = this.seq++;
        const rawInputs = step.Inputs ?? {};
        const inputs: Record<string, Binding> = {};
        const inputKeys = new Set([...Object.keys(action.inputs ?? {}), ...Object.keys(rawInputs)]);
        inputKeys.forEach(k => {
          const raw = rawInputs[k];
          const type = action.inputs?.[k] ?? 'STRING';
          const ref = this.unwrapVar(raw);
          inputs[k] = ref !== null
            ? { mode: 'variable', value: ref, varValue: '' }
            : {
                mode: 'literal',
                value: raw === undefined || raw === null
                  ? defaultLiteral(type)
                  : typeof raw === 'object' ? JSON.stringify(raw) : String(raw),
                varValue: '',
              };
        });

        const rawOutputs = step.Outputs ?? step.outputs ?? {};
        const outputs: Record<string, string> = {};
        const outputKeys = new Set([...Object.keys(action.outputs ?? {}), ...Object.keys(rawOutputs)]);
        outputKeys.forEach(k => {
          outputs[k] = this.unwrapVar(rawOutputs[k]) ?? `${action.name}_${k}_${id}`;
        });

        const node: FlowNode = {
          id,
          x: 160 + depth * 260,
          y: 60 + nodes.length * 120,
          pkg,
          action,
          inputs,
          outputs,
          parentId,
          branch: branch ?? null,
          ...(step.Condition ? { condition: step.Condition } : (['if', 'while'].includes(action.name.toLowerCase()) ? { condition: { Left: '', Operator: action.name.toLowerCase() === 'while' ? 'LessThan' : 'Equals', Right: 0 } } : {})),
        };
        nodes.push(node);
        siblingIds.push(id);

        if (step.Body?.length) loadSteps(step.Body, id, 'Body', depth + 1);
        if (step.Catch?.length) loadSteps(step.Catch, id, 'Catch', depth + 1);
        if (step.Then?.length) loadSteps(step.Then, id, 'Then', depth + 1);
        if (step.Else?.length) loadSteps(step.Else, id, 'Else', depth + 1);
      }

      // Connections are created only between siblings in the same sequence/branch.
      for (let i = 1; i < siblingIds.length; i++) {
        conns.push({ id: this.seq++, from: siblingIds[i - 1], to: siblingIds[i] });
      }
    };

    loadSteps(rootSteps);

    // Treat variables not produced by any root or nested action as declared input variables.
    const produced = new Set(nodes.flatMap(n => Object.values(n.outputs).map(varName)));
    const declared: FlowVariable[] = Object.entries(wf.variables ?? {})
      .filter(([name]) => !produced.has(name))
      .map(([name, v]) => {
        const t = mapType(String(v.type)) as VarType;
        return {
          name,
          type: this.VAR_TYPES.includes(t) ? t : 'STRING',
          value: v.value === null || v.value === undefined ? (t === 'LIST' ? '[]' : '') : typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value),
        };
      });

    this.nodes.set(nodes);
    this.connections.set(conns);
    this.variables.set(declared);

    if (missing.length) {
      this.submitSuccess.set(false);
      this.submitMessage.set(`Some actions were skipped because they were not found in the package library: ${missing.join(', ')}`);
    }
  }


  keys = (o: object) => Object.keys(o);
  orderOf = (id: number) => this.order().indexOf(id) + 1;
  touch() { this.nodes.update(n => [...n]); }
  set(b: Binding, field: keyof Binding, v: string) { (b as any)[field] = v; this.touch(); }
  setOutput(n: FlowNode, key: string, value: string) { n.outputs[key] = value; this.touch(); }
  select(id: number) { this.selectedId.set(id); this.tab.set('props'); }

  actionIcon(node: FlowNode): string {
    const name = node.action.name.toLowerCase();
    const pkg = (node.pkg.className ?? node.pkg.name).toLowerCase();
    if (name === 'trycatch') return 'shield-check';
    if (name === 'if') return 'git-branch';
    if (['foreach', 'forcount', 'while', 'loop'].includes(name)) return 'repeat';
    if (name === 'break' || name === 'continue') return 'corner-down-right';
    if (name === 'evaluate') return 'function-square';
    if (name === 'setvariable') return 'variable';
    if (name === 'return') return 'log-out';
    if (pkg.includes('notification')) return 'bell-ring';
    return 'zap';
  }

  actionColor(node: FlowNode): string {
    const name = node.action.name.toLowerCase();
    const pkg = (node.pkg.className ?? node.pkg.name).toLowerCase();
    if (name === 'if') return '#8b5cf6';
    if (['trycatch', 'break', 'continue', 'return'].includes(name)) return '#64748b';
    if (['foreach', 'forcount', 'while', 'loop'].includes(name)) return '#0d9488';
    if (name === 'evaluate') return '#2563eb';
    if (name === 'setvariable') return '#db2777';
    if (pkg.includes('notification')) return '#ea580c';
    return this.accentOf(node.pkg.id);
  }

  actionDescription(node: FlowNode): string {
    const descriptions: Record<string, string> = {
      trycatch: 'Run actions safely and handle errors',
      if: 'Choose a path based on a condition',
      setvariable: 'Set a value in a workflow variable',
      evaluate: 'Evaluate an expression',
      foreach: 'Run actions for each item in a collection',
      forcount: 'Repeat actions over a numeric range',
      while: 'Repeat while a condition is true',
      break: 'Exit the current loop',
      continue: 'Skip to the next loop iteration',
      return: 'Finish the current workflow'
    };
    return descriptions[node.action.name.toLowerCase()] ?? `${node.pkg.name} action`;
  }

  isLoop(node: FlowNode): boolean {
    return ['foreach', 'forcount', 'while', 'loop'].includes(node.action.name.toLowerCase());
  }

  branchesFor(node: FlowNode): WorkflowBranch[] {
    const name = node.action.name.toLowerCase();
    if (name === 'trycatch') return ['Body', 'Catch'];
    if (name === 'if') return ['Then', 'Else'];
    if (this.isLoop(node)) return ['Body'];
    return [];
  }

  branchLabel(branch: WorkflowBranch): string {
    return ({ Body: 'Do', Catch: 'On error', Then: 'If yes', Else: 'If no' } as Record<WorkflowBranch, string>)[branch];
  }

  conditionValue(node: FlowNode, field: keyof WorkflowCondition): string {
    const value = node.condition?.[field];
    return value === null || value === undefined ? '' : String(value);
  }

  updateConditionFromText(node: FlowNode, field: keyof WorkflowCondition, value: string): void {
    this.setCondition(node.id, field, field === 'Operator' ? value : this.parseConditionValue(value));
  }

  addActionFromPalette(pkg: BotPackage, action: PackageAction): void {
    const root = this.rootNodes();
    const y = root.length ? Math.max(...root.map(n => n.y + this.NODE_H + 56)) : 60;
    this.addNode(pkg, action, 300, y);
  }

  // ---- submit
  submitWorkflow(): void {
    if (this.submitting()) return;

    const flowName = this.flowName().trim();
    const flowVersion = this.flowVersion().trim();

    if (!flowName || !flowVersion) {
      this.submitSuccess.set(false);
      this.submitMessage.set('Flow name and version are required.');
      return;
    }
    if (!this.nodes().length) {
      this.submitSuccess.set(false);
      this.submitMessage.set('Please add at least one action.');
      return;
    }

    const workflow = generateWorkflow(flowName, flowVersion, this.nodes(), this.connections(), this.variables());

    this.submitting.set(true);
    this.submitMessage.set('');

    // NOTE: an opened workflow still saves through /upload, which returns 409 for an
    // existing name + version. Bump the version, or add a PUT /api/Workflows/{id}
    // endpoint and call it here when workflowId() is set.
    this.http.post(WORKFLOW_UPLOAD_URL, workflow).subscribe({
      next: (response: any) => {
        this.submitSuccess.set(true);
        this.submitMessage.set(response?.message ?? response?.Message ?? 'Workflow submitted successfully.');
        this.submitting.set(false);
      },
      error: (error) => {
        this.submitSuccess.set(false);
        if (error.status === 409) {
          this.submitMessage.set(error.error?.error ?? `Workflow '${flowName}' version '${flowVersion}' already exists.`);
        } else if (error.status === 0) {
          this.submitMessage.set('Unable to connect to the API. Check the server and HTTPS certificate.');
        } else {
          this.submitMessage.set(error.error?.error ?? error.error?.message ?? `Failed to submit workflow. HTTP status: ${error.status}`);
        }
        this.submitting.set(false);
      },
    });
  }

  // ---- palette -> canvas
  onDragStart(e: DragEvent, pkg: BotPackage, a: PackageAction) {
    e.dataTransfer!.setData('text/plain', `${pkg.id}:${a.id}`);
    e.dataTransfer!.effectAllowed = 'copy';
  }
  onDrop(e: DragEvent) {
    e.preventDefault();
    const [pid, aid] = (e.dataTransfer?.getData('text/plain') ?? '').split(':').map(Number);
    const pkg = this.packages().find(p => p.id === pid);
    const action = pkg?.actions.find(a => a.id === aid);
    if (!pkg || !action) return;
    const p = this.toSurface(e);
    this.addNode(pkg, action, p.x - this.NODE_W / 2, p.y - this.NODE_H / 2);
  }

  addNode(pkg: BotPackage, action: PackageAction, x: number, y: number) {
    const id = this.seq++;
    const inputs: Record<string, Binding> = {};
    this.keys(action.inputs).forEach(k => (inputs[k] = { mode: 'literal', value: defaultLiteral(action.inputs[k]), varValue: '' }));
    const outputs: Record<string, string> = {};
    this.keys(action.outputs).forEach(k => (outputs[k] = `${action.name}_${k}_${id}`));
    const node: FlowNode = { id, x: Math.max(0, x), y: Math.max(0, y), pkg, action, inputs, outputs, parentId: null, branch: null };
    if (action.name.toLowerCase() === 'if') {
      node.condition = { Left: '', Operator: 'GreaterThanOrEqual', Right: 0 };
    }
    this.nodes.update(n => [...n, node]);
    this.select(id);
  }

  /** Assign an action to a TryCatch/If branch. Expose this for the node properties template. */
  setNodePlacement(nodeId: number, parentId: number | null, branch: WorkflowBranch | null) {
    const list = this.nodes();
    const node = list.find(n => n.id === nodeId);
    if (!node) return;
    if (parentId === nodeId) return;

    if (parentId !== null) {
      const parent = list.find(n => n.id === parentId);
      if (!parent || !branch) return;
      const parentAction = parent.action.name.toLowerCase();
      const validBranch = parentAction === 'trycatch'
        ? branch === 'Body' || branch === 'Catch'
        : parentAction === 'if'
          ? branch === 'Then' || branch === 'Else'
          : ['foreach', 'forcount', 'while', 'loop'].includes(parentAction)
            ? branch === 'Body'
            : false;
      if (!validBranch) return;

      // Prevent parent/child cycles in the generated workflow tree.
      let ancestor: FlowNode | undefined = parent;
      while (ancestor) {
        if (ancestor.id === nodeId) return;
        ancestor = ancestor.parentId == null ? undefined : list.find(n => n.id === ancestor!.parentId);
      }
    }

    // Connections encode ordering inside a sibling list, so discard this node's old edges.
    this.connections.update(items => items.filter(c => c.from !== nodeId && c.to !== nodeId));
    this.nodes.update(items => items.map(n => n.id === nodeId
      ? { ...n, parentId, branch: parentId === null ? null : branch }
      : n));
    this.touch();
  }

  /** Update the Core.If condition from the properties template. */
  setCondition(nodeId: number, field: keyof WorkflowCondition, value: unknown) {
    this.nodes.update(list => list.map(n => {
      if (n.id !== nodeId) return n;
      const current = n.condition ?? { Left: '', Operator: 'equal', Right: '' };
      return { ...n, condition: { ...current, [field]: value } as WorkflowCondition };
    }));
    this.touch();
  }

  /** Top-level actions, ordered by their workflow connections/position. */
  // rootNodes(): FlowNode[] {
  //   const roots = this.nodes().filter(n => n.parentId == null);
  //   const ids = new Set(roots.map(n => n.id));
  //   return sortNodes(roots, this.connections().filter(c => ids.has(c.from) && ids.has(c.to)));
  // }

isDescendant(parentId: number, nodeId: number): boolean {
  const nodeMap = new Map(
    this.nodes().map(node => [node.id, node])
  );

  let current = nodeMap.get(parentId);

  while (current?.parentId != null) {
    if (current.parentId === nodeId) {
      return true;
    }

    current = nodeMap.get(current.parentId);
  }

  return false;
}

 rootNodes = computed(() =>
  this.nodes().filter(node =>
    node.parentId === null || node.parentId === undefined
  )
);

  /** Children rendered inside a TryCatch/If branch, in execution order. */
  childrenOf(parentId: number, branch: WorkflowBranch): FlowNode[] {
    const children = this.nodes().filter(n => n.parentId === parentId && n.branch === branch);
    const ids = new Set(children.map(n => n.id));
    return sortNodes(children, this.connections().filter(c => ids.has(c.from) && ids.has(c.to)));
  }

  isTryCatch(node: FlowNode): boolean {
    return node.action.name.toLowerCase() === 'trycatch';
  }

  isIf(node: FlowNode): boolean {
    return node.action.name.toLowerCase() === 'if';
  }

  parentActionName(parentId: number): string {
    const parent = this.nodes().find(n => n.id === parentId);
    return parent ? parent.action.name : 'parent action';
  }

  zoomPercent(): number {
    return Math.round(this.zoom() * 100);
  }

  /** Keep numeric condition values numeric in the emitted JSON; preserve variable references as text. */
  parseConditionValue(value: string): unknown {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    if (/^\{\{\s*.+?\s*\}\}$/.test(trimmed)) return trimmed;
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }

  /** Handle a palette action dropped into a specific control-flow branch. */
  dropIntoBranch(e: DragEvent, parentId: number, branch: WorkflowBranch): void {
    e.preventDefault();
    e.stopPropagation();
    const [pid, aid] = (e.dataTransfer?.getData('text/plain') ?? '').split(':').map(Number);
    const pkg = this.packages().find(p => p.id === pid);
    const action = pkg?.actions.find(a => a.id === aid);
    if (!pkg || !action) return;

    const point = this.toSurface(e);
    this.addNode(pkg, action, point.x - this.NODE_W / 2, point.y - this.NODE_H / 2);
    const newNodeId = this.seq - 1;
    this.setNodePlacement(newNodeId, parentId, branch);
  }

  removeNode(id: number) {
    // Removing a control-flow parent also removes its nested branch actions.
    const removed = new Set<number>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes()) {
        if (node.parentId != null && removed.has(node.parentId) && !removed.has(node.id)) {
          removed.add(node.id);
          changed = true;
        }
      }
    }
    this.nodes.update(list => list.filter(node => !removed.has(node.id)));
    this.connections.update(list => list.filter(c => !removed.has(c.from) && !removed.has(c.to)));
    this.selectedId.set(null);
  }
  removeConnection(id: number) { this.connections.update(c => c.filter(x => x.id !== id)); }

  // ---- node dragging & connecting
  startDrag(e: PointerEvent, n: FlowNode) {
    e.preventDefault();
    const p = this.toSurface(e);
    this.dragging = { n, dx: p.x - n.x, dy: p.y - n.y };
  }
  startConnect(e: PointerEvent, n: FlowNode) {
    e.preventDefault(); e.stopPropagation();
    const p = this.toSurface(e);
    this.pending.set({ from: n.id, x: p.x, y: p.y });
  }
  finishConnect(toId: number) {
    const p = this.pending();
    if (!p || p.from === toId) return;
    const exists = this.connections().some(c => c.from === p.from && c.to === toId);
    if (exists || this.reaches(toId, p.from)) return;
    this.connections.update(c => [...c, { id: this.seq++, from: p.from, to: toId }]);
  }
  private reaches(a: number, b: number): boolean {
    const seen = new Set<number>(); const stack = [a];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === b) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      this.connections().filter(c => c.from === x).forEach(c => stack.push(c.to));
    }
    return false;
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(e: PointerEvent) {
    if (!this.dragging && !this.pending()) return;
    const p = this.toSurface(e);
    if (this.dragging) {
      const d = this.dragging;
      d.n.x = Math.max(0, p.x - d.dx);
      d.n.y = Math.max(0, p.y - d.dy);
      this.touch();
    } else {
      this.pending.update(v => ({ ...v!, x: p.x, y: p.y }));
    }
  }
  @HostListener('document:pointerup')
  onUp() { this.dragging = null; this.pending.set(null); }

  @HostListener('document:keydown.delete', ['$event'])
  onDelete(e: Event) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const id = this.selectedId();
    if (id !== null) this.removeNode(id);
  }

  // ---- wires (CHANGED: vertical, bottom port -> top port, like the Power Automate designer)
  path(c: Connection) {
    const a = this.nodes().find(n => n.id === c.from), b = this.nodes().find(n => n.id === c.to);
    return a && b
      ? this.curve(a.x + this.NODE_W / 2, a.y + this.NODE_H, b.x + this.NODE_W / 2, b.y)
      : '';
  }
  pendingPath() {
    const p = this.pending(); const a = p && this.nodes().find(n => n.id === p.from);
    return p && a ? this.curve(a.x + this.NODE_W / 2, a.y + this.NODE_H, p.x, p.y) : '';
  }
  private curve(x1: number, y1: number, x2: number, y2: number) {
    const dy = Math.max(30, Math.abs(y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
  // CHANGED: divide by zoom so drops / drags stay accurate when the surface is scaled
  private toSurface(e: { clientX: number; clientY: number }) {
    const r = this.surface().nativeElement.getBoundingClientRect();
    const z = this.zoom();
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  }

  // ---- output
  async copy() {
    await navigator.clipboard.writeText(this.json());
    this.copied.set(true); setTimeout(() => this.copied.set(false), 1500);
  }
  download() {
    const blob = new Blob([this.json()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.flowName().replace(/\s+/g, '_') || 'workflow'}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }
}
