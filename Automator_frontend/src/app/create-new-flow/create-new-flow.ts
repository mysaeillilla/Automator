import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment.development';

/* ============================================================================
 * Types
 * ========================================================================== */

// ---- API DTOs (GET /api/Packages, POST /api/Execution/execute)
interface ActionDef {
  id: number;
  packageId: number;
  name: string;
  description: string;
  category: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  blocks: string[]; // e.g. ["Then","Else"], ["Body"], ["Body","Catch"]
  hasCondition: boolean;
  conditionOperators: string[];
  logicalOperators: string[];
  supportsMultipleConditions: boolean;
  properties: Record<string, string>;
}
interface WorkflowSaveResponse {
  success: boolean;
  message: string;
  id: number;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
}
interface PackageDto {
  id: number;
  name: string;
  version: string;
  filePath: string | null;
  description: string;
  dependencies: string[];
  isBuiltIn: boolean;
  actions: ActionDef[];
}

interface ExecuteRequest {
  dllPath: string;
  functionName: string;
  className: string;
  inputs: Record<string, string>;
}

interface ExecuteResponse {
  success: boolean;
  error?: string | null;
  [key: string]: unknown;
}

// ---- Flow JSON (the saved workflow format)
type FlowValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'LIST' | 'OBJECT' | 'ANY';

export interface FlowJson {
  flow_name: string;
  version: string;
  packages: Record<string, string>;
  variables: Record<string, { value: unknown; type: string; input: boolean; output: boolean }>;
  Actions: Record<string, any>;
}

// ---- Editor model (serialised to FlowJson on save/export)
interface ConditionRow {
  left: string;
  operator: string;
  right: string;
  logical: 'AND' | 'OR';
}

interface FlowNode {
  uid: string;
  packageName: string; // -> "ClassName"
  functionName: string; // -> "FunctionName"
  label: string; // optional display name -> "Label"
  inputs: Record<string, string>; // text in the editor, coerced on save
  outputs: Record<string, string>; // output name -> variable name (no braces)
  conditions: ConditionRow[];
  blocks: Record<string, FlowNode[]>; // Then / Else / Body / Catch ...
}

interface FlowVariable {
  name: string;
  type: FlowValueType;
  valueText: string;
  input: boolean;
  output: boolean;
}

interface LaneRef {
  parentUid: string | null;
  block: string;
}
interface AddTarget extends LaneRef {
  index: number;
}
interface RunState {
  status: 'running' | 'ok' | 'error';
  message?: string;
  request?: ExecuteRequest;
  response?: unknown;
}
interface CatalogItem {
  pkg: PackageDto;
  def: ActionDef;
}
interface CatalogGroup {
  name: string;
  color: string;
  items: CatalogItem[];
}

/* ============================================================================
 * Constants & display helpers
 * ========================================================================== */

const VALUE_TYPES: FlowValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'LIST', 'OBJECT', 'ANY'];

const GROUP_FLOW = 'Flow control';
const GROUP_VARS = 'Variables';
const CONTROL_ACTIONS = new Set(['If', 'While', 'ForEach', 'ForCount', 'TryCatch', 'Break', 'Continue', 'Return', 'Fail']);
const VARIABLE_ACTIONS = new Set(['SetVariable', 'Evaluate']);
const GROUP_COLORS: Record<string, string> = { [GROUP_FLOW]: '#486991', [GROUP_VARS]: '#a4262c' };
const PALETTE = ['#0f6cbd', '#038387', '#8764b8', '#ca5010', '#498205', '#9f3f8f'];

const ICON_PATHS = {
  branch: 'M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6 3v12M18 9a9 9 0 0 1-9 9',
  loop: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  braces: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  stop: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9l6 6M15 9l-6 6',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  flask: 'M9 3h6M10 3v6L4 20h16L14 9V3',
};
const iconPath = (name: string) => (ICON_PATHS as Record<string, string>)[name] ?? ICON_PATHS.box;

const FUNCTION_ICON: Record<string, string> = {
  If: 'branch', While: 'loop', ForEach: 'loop', ForCount: 'loop', TryCatch: 'shield',
  Break: 'stop', Continue: 'stop', Return: 'stop', Fail: 'stop', SetVariable: 'braces', Evaluate: 'braces',
};
const FRIENDLY: Record<string, string> = {
  If: 'Condition', While: 'While', ForEach: 'For each', ForCount: 'For count', TryCatch: 'Try / catch',
  SetVariable: 'Set variable', Evaluate: 'Evaluate expression',
};
const OPERATOR_LABEL: Record<string, string> = {
  Equals: 'is equal to', NotEquals: 'is not equal to', GreaterThan: 'is greater than',
  GreaterThanOrEqual: 'is greater than or equal to', LessThan: 'is less than', LessThanOrEqual: 'is less than or equal to',
  Contains: 'contains', NotContains: 'does not contain', StartsWith: 'starts with', EndsWith: 'ends with',
  IsEmpty: 'is empty', IsNotEmpty: 'is not empty', IsNull: 'is null', IsNotNull: 'is not null', IsTrue: 'is true', IsFalse: 'is false',
};
const OPERATOR_SYMBOL: Record<string, string> = {
  Equals: '=', NotEquals: '≠', GreaterThan: '>', GreaterThanOrEqual: '≥', LessThan: '<', LessThanOrEqual: '≤',
};
const UNARY_OPERATORS = new Set(['IsEmpty', 'IsNotEmpty', 'IsNull', 'IsNotNull', 'IsTrue', 'IsFalse']);

/** Which palette group an action is listed under. Prefer an explicit `category` from the API. */
function groupOf(pkg: PackageDto, a: ActionDef): string {
  if (a.category === 'ControlFlow' || a.blocks.length > 0 || (pkg.isBuiltIn && CONTROL_ACTIONS.has(a.name))) return GROUP_FLOW;
  if (a.category === 'Variables' || (pkg.isBuiltIn && VARIABLE_ACTIONS.has(a.name))) return GROUP_VARS;
  return pkg.name;
}
const friendlyName = (fn: string) => FRIENDLY[fn] ?? fn.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const titleOf = (n: FlowNode) => n.label || friendlyName(n.functionName);
const iconOf = (n: Pick<FlowNode, 'functionName' | 'packageName'>) =>
  FUNCTION_ICON[n.functionName] ?? (/notif/i.test(n.packageName) ? 'bell' : 'box');

function blockLabel(fn: string, block: string): string {
  if (block === 'Body') return fn === 'TryCatch' ? 'Try' : '';
  return ({ Then: 'If yes', Else: 'If no', Catch: 'On error' } as Record<string, string>)[block] ?? block;
}

/** One-line preview under the card title. */
function summaryOf(n: FlowNode): string {
  let s = '';
  if (n.conditions.some((c) => c.left)) {
    s = n.conditions
      .filter((c) => c.left)
      .map((c) => [c.left, OPERATOR_SYMBOL[c.operator] ?? OPERATOR_LABEL[c.operator] ?? c.operator, UNARY_OPERATORS.has(c.operator) ? '' : c.right].join(' ').trim())
      .join(' ' + (n.conditions[1]?.logical ?? 'AND').toLowerCase() + ' ');
  } else {
    s = Object.values(n.inputs).find((v) => v !== '') ?? '';
  }
  return s.length > 70 ? s.slice(0, 67) + '…' : s;
}

/* ============================================================================
 * Tree helpers (immutable)
 * ========================================================================== */

const newUid = () => 'n' + Math.random().toString(36).slice(2, 10);

const mapValues = <T, U>(o: Record<string, T>, f: (v: T) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

function findNode(nodes: FlowNode[], uid: string): FlowNode | null {
  for (const n of nodes) {
    if (n.uid === uid) return n;
    for (const lane of Object.values(n.blocks)) {
      const hit = findNode(lane, uid);
      if (hit) return hit;
    }
  }
  return null;
}
/** Apply fn to every lane (array of siblings) in the tree, top-down. */
function mapLanes(nodes: FlowNode[], fn: (lane: FlowNode[]) => FlowNode[]): FlowNode[] {
  return fn(nodes).map((n) => (Object.keys(n.blocks).length ? { ...n, blocks: mapValues(n.blocks, (l) => mapLanes(l, fn)) } : n));
}
/** Apply fn to every node in the tree. */
function mapNodes(nodes: FlowNode[], fn: (n: FlowNode) => FlowNode): FlowNode[] {
  return nodes.map((n) => {
    const m = fn(n);
    return Object.keys(m.blocks).length ? { ...m, blocks: mapValues(m.blocks, (l) => mapNodes(l, fn)) } : m;
  });
}
const cloneNode = (n: FlowNode): FlowNode => ({
  ...n,
  uid: newUid(),
  inputs: { ...n.inputs },
  outputs: { ...n.outputs },
  conditions: n.conditions.map((c) => ({ ...c })),
  blocks: mapValues(n.blocks, (l) => l.map(cloneNode)),
});

/* ============================================================================
 * Serialisation (editor <-> flow JSON)
 * ========================================================================== */

type ActionLookup = (pkg: string, fn: string) => ActionDef | undefined;

const RESERVED = new Set(['ClassName', 'FunctionName', 'Inputs', 'Outputs', 'Condition', 'Conditions', 'Label']);
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const SINGLE_TEMPLATE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
const ANY_TEMPLATE = /\{\{\s*([^}]+?)\s*\}\}/g;

function coerce(value: string, type = 'ANY'): unknown {
  const t = type.toUpperCase();
  if (t === 'STRING' || SINGLE_TEMPLATE.test(value)) return value;
  if (['NUMBER', 'INT', 'LONG', 'DOUBLE', 'DECIMAL'].includes(t)) return NUMERIC.test(value) ? Number(value) : value;
  if (t === 'BOOL' || t === 'BOOLEAN') return value === 'true' ? true : value === 'false' ? false : value;
  if (NUMERIC.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[[{]/.test(value.trim())) {
    try {
      return JSON.parse(value);
    } catch {
      /* keep as text */
    }
  }
  return value;
}

function parseVariableValue(v: FlowVariable): unknown {
  const t = v.valueText;
  switch (v.type) {
    case 'STRING':
      return t;
    case 'NUMBER': {
      const n = Number(t);
      return t.trim() === '' || Number.isNaN(n) ? 0 : n;
    }
    case 'BOOLEAN':
      return t.trim().toLowerCase() === 'true';
    default:
      if (t.trim() === '') return v.type === 'LIST' ? [] : v.type === 'OBJECT' ? {} : '';
      try {
        return JSON.parse(t);
      } catch {
        return t;
      }
  }
}

const variableValues = (vars: FlowVariable[]) =>
  Object.fromEntries(vars.map((v) => [v.name, parseVariableValue(v)])) as Record<string, unknown>;

/** Resolves {{var}} / {{var.prop}} / {{list[0].prop}}. Always returns text (the execute API takes strings). */
function resolveVars(value: string, vars: Record<string, unknown>): string {
  const get = (path: string) =>
    path
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .reduce<any>((o, k) => (o == null ? undefined : o[k.trim()]), vars);
  const str = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const single = value.match(SINGLE_TEMPLATE);
  return single ? str(get(single[1])) : value.replace(ANY_TEMPLATE, (_, p) => str(get(p)));
}

interface FlowState {
  name: string;
  version: string;
  variables: FlowVariable[];
  steps: FlowNode[];
  packages: PackageDto[];
}

function toFlowJson(s: FlowState, lookup: ActionLookup): FlowJson {
  const used = new Set<string>();

  const ser = (n: FlowNode): Record<string, unknown> => {
    used.add(n.packageName);
    const def = lookup(n.packageName, n.functionName);
    const out: Record<string, unknown> = { ClassName: n.packageName, FunctionName: n.functionName };
    if (n.label) out['Label'] = n.label;

    out['Inputs'] = Object.fromEntries(
      Object.entries(n.inputs).filter(([, v]) => v !== '').map(([k, v]) => [k, coerce(v, def?.inputs[k])]),
    );
    out['Outputs'] = Object.fromEntries(
      Object.entries(n.outputs).filter(([, v]) => v).map(([k, v]) => [k, `{{${v}}}`]),
    );

    const rows = n.conditions.filter((c) => c.left !== '');
    const cond = (c: ConditionRow) => ({ Left: coerce(c.left), Operator: c.operator, Right: coerce(c.right) });
    if (rows.length === 1) out['Condition'] = cond(rows[0]);
    // ASSUMPTION: multi-row conditions. Align this shape with your condition model on the backend.
    else if (rows.length > 1) out['Conditions'] = rows.map((c) => ({ ...cond(c), Logical: c.logical }));

    for (const [block, lane] of Object.entries(n.blocks)) out[block] = lane.map(ser);
    return out;
  };

  const Actions: Record<string, unknown> = {};
  s.steps.forEach((n, i) => (Actions[String(i + 1)] = ser(n)));

  const packages: Record<string, string> = {};
  for (const name of used) {
    const p = s.packages.find((x) => x.name === name);
    if (p?.filePath) packages[name] = p.filePath;
  }

  return {
    flow_name: s.name,
    version: s.version,
    packages,
    variables: Object.fromEntries(
      s.variables.map((v) => [v.name, { value: parseVariableValue(v), type: v.type, input: v.input, output: v.output }]),
    ),
    Actions,
  };
}

const isAction = (x: any) => x && typeof x === 'object' && 'FunctionName' in x;
const asText = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function fromFlowJson(json: FlowJson, lookup: ActionLookup) {
  const deser = (a: any): FlowNode => {
    const def = lookup(a.ClassName, a.FunctionName);
    const blocks: Record<string, FlowNode[]> = {};
    for (const b of def?.blocks ?? []) blocks[b] = [];
    for (const [k, v] of Object.entries(a)) {
      if (!RESERVED.has(k) && Array.isArray(v) && v.every(isAction)) blocks[k] = v.map(deser);
    }

    const row = (c: any): ConditionRow => ({
      left: asText(c.Left),
      operator: c.Operator ?? 'Equals',
      right: asText(c.Right),
      logical: c.Logical === 'OR' ? 'OR' : 'AND',
    });
    let conditions: ConditionRow[] = [];
    if (a.Condition) conditions = [row(a.Condition)];
    else if (Array.isArray(a.Conditions)) conditions = a.Conditions.map(row);
    else if (def?.hasCondition) conditions = [{ left: '', operator: def.conditionOperators[0] ?? 'Equals', right: '', logical: 'AND' }];

    return {
      uid: newUid(),
      packageName: a.ClassName,
      functionName: a.FunctionName,
      label: a.Label ?? '',
      inputs: Object.fromEntries(Object.entries(a.Inputs ?? {}).map(([k, v]) => [k, asText(v)])),
      outputs: Object.fromEntries(
        Object.entries(a.Outputs ?? {}).map(([k, v]) => [k, asText(v).replace(/^\{\{\s*|\s*\}\}$/g, '')]),
      ),
      conditions,
      blocks,
    };
  };

  const variables: FlowVariable[] = Object.entries(json.variables ?? {}).map(([name, v]) => ({
    name,
    type: (String(v.type).toUpperCase() as FlowValueType) || 'ANY',
    valueText: asText(v.value),
    input: !!v.input,
    output: !!v.output,
  }));

  const steps = Object.keys(json.Actions ?? {})
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => deser(json.Actions[k]));

  return { name: json.flow_name ?? 'Untitled flow', version: json.version ?? '1.0.0', variables, steps };
}

/* ============================================================================
 * Component
 * ========================================================================== */

@Component({
  imports: [FormsModule, NgTemplateOutlet],
  selector: 'app-create-new-flow',
  styleUrl: './create-new-flow.css',
  templateUrl: './create-new-flow.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateNewFlow {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  // ---- inputs / outputs
  /** Base URL of the API (…/api/Packages, …/api/Execution/execute). */
  // readonly apiBase = input('https://localhost:5001');

private readonly apiBase = signal(environment.apiUrl);
  /** Optional flow to open (object or JSON text). Loaded once the package catalog is available. */
  readonly flow = input<FlowJson | string | null>(null);
  /** Emits the flow JSON when the user presses Save. */
  readonly saved = output<FlowJson>();

  // ---- flow state
  protected readonly flowName = signal('Untitled flow');
  protected readonly version = signal('1.0.0');
  protected readonly variables = signal<FlowVariable[]>([]);
  protected readonly steps = signal<FlowNode[]>([]);
  protected readonly packages = signal<PackageDto[]>([]);
  protected readonly selectedUid = signal<string | null>(null);
  protected readonly picker = signal<AddTarget | null>(null);
  protected readonly panel = signal<'picker' | 'action' | 'variables' | 'json'>('variables');
  protected readonly runState = signal<Record<string, RunState>>({});

  // ---- ui state
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly tab = signal<'params' | 'test'>('params');

  // ---- template helpers
  protected readonly P = ICON_PATHS;
  protected readonly iconPath = iconPath;
  protected readonly valueTypes = VALUE_TYPES;
  protected readonly opLabel = (op: string) => OPERATOR_LABEL[op] ?? op;
  protected readonly isUnary = (op: string) => UNARY_OPERATORS.has(op);
  protected readonly friendly = friendlyName;
  protected readonly title = titleOf;
  protected readonly summary = summaryOf;
  protected readonly icon = iconOf;
  protected readonly blockKeys = (n: FlowNode) => Object.keys(n.blocks);
  protected readonly label = (n: FlowNode, b: string) => blockLabel(n.functionName, b);
  protected readonly isMultiline = (key: string) => /json|table|expression|message/i.test(key);
  protected readonly responseJson = (r: unknown) => JSON.stringify(r, null, 2);

  private lastFlow: unknown = null;

  // ---- derived state
  private readonly index = computed(() => {
    const m = new Map<string, CatalogItem>();
    for (const pkg of this.packages()) for (const def of pkg.actions) m.set(`${pkg.name}::${def.name}`, { pkg, def });
    return m;
  });

  protected readonly catalog = computed<CatalogGroup[]>(() => {
    const groups = new Map<string, CatalogGroup>();
    let next = 0;
    for (const pkg of this.packages())
      for (const def of pkg.actions) {
        const g = groupOf(pkg, def);
        if (!groups.has(g)) groups.set(g, { name: g, color: GROUP_COLORS[g] ?? PALETTE[next++ % PALETTE.length], items: [] });
        groups.get(g)!.items.push({ pkg, def });
      }
    const rank = (n: string) => (n === GROUP_FLOW ? 0 : n === GROUP_VARS ? 1 : 2);
    return [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name));
  });
  private readonly colors = computed(() => new Map(this.catalog().map((g) => [g.name, g.color])));

  protected readonly filteredCatalog = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.catalog()
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => !q || friendlyName(i.def.name).toLowerCase().includes(q) || i.def.name.toLowerCase().includes(q) || i.def.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length);
  });

  protected readonly selected = computed(() => {
    const id = this.selectedUid();
    return id ? findNode(this.steps(), id) : null;
  });
  protected readonly selectedDef = computed(() => {
    const n = this.selected();
    return n ? this.lookup(n.packageName, n.functionName) : undefined;
  });
  protected readonly selectedPackage = computed(() => {
    const n = this.selected();
    return n ? this.packages().find((p) => p.name === n.packageName) : undefined;
  });
  protected readonly requestPreview = computed(() => {
    const n = this.selected();
    return n ? this.buildRequest(n) : null;
  });
  protected readonly requestJson = computed(() => JSON.stringify(this.requestPreview(), null, 2));

  protected readonly inputKeys = computed(() => {
    const n = this.selected();
    return [...new Set([...Object.keys(this.selectedDef()?.inputs ?? {}), ...Object.keys(n?.inputs ?? {})])];
  });
  protected readonly outputKeys = computed(() => {
    const n = this.selected();
    return [...new Set([...Object.keys(this.selectedDef()?.outputs ?? {}), ...Object.keys(n?.outputs ?? {})])];
  });
  protected readonly operators = computed(() => {
    const ops = this.selectedDef()?.conditionOperators;
    return ops?.length ? ops : Object.keys(OPERATOR_LABEL);
  });
  protected readonly canAddCondition = computed(() => this.selectedDef()?.supportsMultipleConditions ?? true);

  protected readonly json = computed<FlowJson>(() =>
    toFlowJson(
      { name: this.flowName(), version: this.version(), variables: this.variables(), steps: this.steps(), packages: this.packages() },
      (p, f) => this.lookup(p, f),
    ),
  );
  protected readonly jsonText = computed(() => JSON.stringify(this.json(), null, 2));

  private readonly lookup: ActionLookup = (pkg, fn) => this.index().get(`${pkg}::${fn}`)?.def;

  constructor() {
    this.loadPackages();
    effect(() => {
      const f = this.flow();
      if (!this.loading() && f && f !== this.lastFlow) {
        this.lastFlow = f;
        untracked(() => this.safely(() => this.loadFlow(f)));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Packages
  // ---------------------------------------------------------------------------
  protected loadPackages() {
    this.loading.set(true);
    this.loadError.set(null);
    this.http
      .get<PackageDto[]>(`${this.apiBase()}/api/Packages`, { params: { includeCore: true } })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.setPackages(p);
          this.loading.set(false);
        },
        error: (e: HttpErrorResponse) => {
          this.loadError.set(`Couldn't load packages (${e.status || 'network error'}). Check that the API is running and allows this origin (CORS).`);
          this.loading.set(false);
        },
      });
  }

  private setPackages(pkgs: PackageDto[]) {
    // The API can return two "Core" packages (built-in + a stray row with empty block metadata).
    // Keep one package per name, preferring the built-in one.
    const byName = new Map<string, PackageDto>();
    for (const p of pkgs) {
      const cur = byName.get(p.name);
      if (!cur || (p.isBuiltIn && !cur.isBuiltIn)) byName.set(p.name, p);
    }
    this.packages.set([...byName.values()]);
  }

  protected colorOf(n: FlowNode): string {
    const hit = this.index().get(`${n.packageName}::${n.functionName}`);
    return (hit && this.colors().get(groupOf(hit.pkg, hit.def))) || '#8a8886';
  }

  private loadFlow(src: FlowJson | string) {
    const json: FlowJson = typeof src === 'string' ? JSON.parse(src) : src;
    const f = fromFlowJson(json, this.lookup);
    this.flowName.set(f.name);
    this.version.set(f.version);
    this.variables.set(f.variables);
    this.steps.set(f.steps);
    this.runState.set({});
    this.closePanel();
  }

  // ---------------------------------------------------------------------------
  // Selection / panels
  // ---------------------------------------------------------------------------
  protected select(uid: string) {
    this.selectedUid.set(uid);
    this.picker.set(null);
    this.panel.set('action');
  }
  protected openPicker(parentUid: string | null, block: string, index: number) {
    this.picker.set({ parentUid, block, index });
    this.selectedUid.set(null);
    this.panel.set('picker');
  }
  protected closePanel() {
    this.selectedUid.set(null);
    this.picker.set(null);
    this.panel.set('variables');
  }

  // ---------------------------------------------------------------------------
  // Tree edits
  // ---------------------------------------------------------------------------
  private editLane(t: LaneRef, fn: (lane: FlowNode[]) => FlowNode[]) {
    if (t.parentUid === null) return this.steps.update(fn);
    this.steps.update((s) =>
      mapNodes(s, (n) => (n.uid === t.parentUid ? { ...n, blocks: { ...n.blocks, [t.block]: fn(n.blocks[t.block] ?? []) } } : n)),
    );
  }

  private createNode(pkg: PackageDto, def: ActionDef): FlowNode {
    return {
      uid: newUid(),
      packageName: pkg.name,
      functionName: def.name,
      label: '',
      inputs: mapValues(def.inputs, () => ''),
      outputs: mapValues(def.outputs, () => ''),
      conditions: def.hasCondition ? [{ left: '', operator: def.conditionOperators[0] ?? 'Equals', right: '', logical: 'AND' }] : [],
      blocks: Object.fromEntries(def.blocks.map((b) => [b, [] as FlowNode[]])),
    };
  }

  protected addAction(pkg: PackageDto, def: ActionDef) {
    const t = this.picker();
    if (!t) return;
    const node = this.createNode(pkg, def);
    this.editLane(t, (lane) => [...lane.slice(0, t.index), node, ...lane.slice(t.index)]);
    this.select(node.uid);
  }

  protected removeNode(uid: string) {
    this.steps.update((s) => mapLanes(s, (lane) => lane.filter((n) => n.uid !== uid)));
    if (this.selectedUid() === uid || !this.selected()) this.closePanel();
  }

  protected moveNode(uid: string, dir: -1 | 1) {
    this.steps.update((s) =>
      mapLanes(s, (lane) => {
        const i = lane.findIndex((n) => n.uid === uid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= lane.length) return lane;
        const c = [...lane];
        [c[i], c[j]] = [c[j], c[i]];
        return c;
      }),
    );
  }

  protected duplicateNode(uid: string) {
    this.steps.update((s) =>
      mapLanes(s, (lane) => {
        const i = lane.findIndex((n) => n.uid === uid);
        return i < 0 ? lane : [...lane.slice(0, i + 1), cloneNode(lane[i]), ...lane.slice(i + 1)];
      }),
    );
  }

  protected patchNode(uid: string, patch: Partial<FlowNode>) {
    this.steps.update((s) => mapNodes(s, (n) => (n.uid === uid ? { ...n, ...patch } : n)));
  }
  protected setInput(uid: string, key: string, value: string) {
    const n = findNode(this.steps(), uid);
    if (n) this.patchNode(uid, { inputs: { ...n.inputs, [key]: value } });
  }
  protected setOutput(uid: string, key: string, value: string) {
    const n = findNode(this.steps(), uid);
    if (n) this.patchNode(uid, { outputs: { ...n.outputs, [key]: value } });
  }
  protected setCondition(uid: string, i: number, patch: Partial<ConditionRow>) {
    const n = findNode(this.steps(), uid);
    if (n) this.patchNode(uid, { conditions: n.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  protected addCondition(uid: string) {
    const n = findNode(this.steps(), uid);
    if (n) this.patchNode(uid, { conditions: [...n.conditions, { left: '', operator: n.conditions[0]?.operator ?? 'Equals', right: '', logical: 'AND' }] });
  }
  protected removeCondition(uid: string, i: number) {
    const n = findNode(this.steps(), uid);
    if (n) this.patchNode(uid, { conditions: n.conditions.filter((_, idx) => idx !== i) });
  }

  protected insertVar(key: string, el: HTMLSelectElement) {
    const n = this.selected();
    if (n && el.value) this.setInput(n.uid, key, (n.inputs[key] ?? '') + `{{${el.value}}}`);
    el.value = '';
  }
  protected insertCondVar(i: number, side: 'left' | 'right', el: HTMLSelectElement) {
    const n = this.selected();
    if (n && el.value) {
      const next = (n.conditions[i][side] ?? '') + `{{${el.value}}}`;
      this.setCondition(n.uid, i, side === 'left' ? { left: next } : { right: next });
    }
    el.value = '';
  }
  protected inputType = (key: string) => (this.selectedDef()?.inputs[key] ?? 'ANY').toLowerCase();

  // ---------------------------------------------------------------------------
  // Variables
  // ---------------------------------------------------------------------------
  protected addVariable() {
    const names = new Set(this.variables().map((v) => v.name));
    let i = names.size + 1;
    while (names.has('var' + i)) i++;
    this.variables.update((v) => [...v, { name: 'var' + i, type: 'STRING', valueText: '', input: false, output: false }]);
  }
  protected updateVariable(i: number, patch: Partial<FlowVariable>) {
    this.variables.update((v) => v.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  protected removeVariable(i: number) {
    this.variables.update((v) => v.filter((_, idx) => idx !== i));
  }
  protected duplicateName(name: string) {
    return this.variables().filter((v) => v.name === name).length > 1;
  }

  // ---------------------------------------------------------------------------
  // Run a single action (POST /api/Execution/execute)
  // ---------------------------------------------------------------------------
  /** Core actions have no DLL (the flow engine interprets them), so they return null here. */
  private buildRequest(node: FlowNode): ExecuteRequest | null {
    const pkg = this.packages().find((p) => p.name === node.packageName);
    if (!pkg?.filePath) return null;
    const vars = variableValues(this.variables());
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(node.inputs)) if (v !== '') inputs[k] = resolveVars(v, vars);
    // className: this project uses the package name as ClassName. Change here if your DLL exposes a namespaced class.
    return { dllPath: pkg.filePath, className: pkg.name, functionName: node.functionName, inputs };
  }

  private setRun(uid: string, s: RunState) {
    this.runState.update((r) => ({ ...r, [uid]: s }));
  }

  protected runNode(uid: string) {
    const node = findNode(this.steps(), uid);
    if (!node) return;
    const request = this.buildRequest(node);
    if (!request) {
      this.setRun(uid, { status: 'error', message: 'Core actions run inside the flow engine and cannot be run on their own.' });
      return;
    }
    this.setRun(uid, { status: 'running', request });
    this.http.post<ExecuteResponse>(`${this.apiBase()}/api/Execution/execute`, request).subscribe({
      next: (res) =>
        this.setRun(uid, { status: res.success ? 'ok' : 'error', message: res.success ? 'Succeeded' : (res.error ?? 'Failed'), request, response: res }),
      error: (e: HttpErrorResponse) =>
        this.setRun(uid, { status: 'error', message: e.error?.error ?? e.message, request, response: e.error }),
    });
  }

  protected looksLikePathError(msg?: string) {
    return !!msg && /allowed directory|outside/i.test(msg);
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------
  // protected save() {
  //   this.saved.emit(this.json());
  //   this.flash('Saved');
  // }

protected saved124 = output<WorkflowSaveResponse>();

protected save() {
  const workflowJson = this.json();

  this.http.post<WorkflowSaveResponse>(
    `${this.apiBase()}/api/Workflows/upload`,
    workflowJson
  ).subscribe({
    next: (response) => {
      if (response.success) {
        this.saved124.emit(response);
        this.flash(response.message || 'Workflow saved successfully');
      }
    },
    error: (error) => {
      console.error('Workflow save failed:', error);

      this.flash(
        error.error?.message || 'Failed to save workflow'
      );
    }
  });}

  protected exportFile() {
    const blob = new Blob([this.jsonText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.flowName().replace(/\W+/g, '_') || 'flow'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected importFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    file?.text().then((t) => this.safely(() => this.loadFlow(t)));
  }

  protected async copyJson() {
    await navigator.clipboard.writeText(this.jsonText());
    this.flash('Copied');
  }

  protected onCanvasClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) this.closePanel();
  }

  private safely(fn: () => void) {
    try {
      fn();
    } catch (e) {
      this.flash(`Couldn't open that flow: ${(e as Error).message}`);
    }
  }
  private flash(msg: string) {
    this.notice.set(msg);
    setTimeout(() => this.notice.set(null), 3500);
  }
}
