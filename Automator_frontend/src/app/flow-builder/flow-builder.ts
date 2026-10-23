import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

// Tip: use a dev proxy (proxy.conf.json: "/api" -> https://localhost:5002, secure:false)
// and set this to '/api/Packages' to avoid CORS / self-signed cert issues.
const API_URL = 'https://localhost:5002/api/Packages';

const WORKFLOW_UPLOAD_URL =
  'https://localhost:5002/api/Workflows/upload';
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
  className?: string; // optional: add this to your API so the workflow gets the real class name
}

/** literal = typed value, variable = {{variableName}} reference */
export interface Binding {
  mode: 'literal' | 'variable';
  value: string;     // literal text OR the variable name
  varValue: string;  // initial value of the variable (variable mode only)
}

export interface FlowNode {
  id: number;
  x: number;
  y: number;
  pkg: BotPackage;
  action: PackageAction;
  inputs: Record<string, Binding>;
  outputs: Record<string, string>; // output name -> variable name
}

export interface Connection {
  id: number;
  from: number;
  to: number;
}

// ───────────────────────── Workflow generator ─────────────────────────

// Class names aren't in the packages API, so map them here (or add `className` to the API).
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

export const defaultFor = (t: string): string | number | boolean => {
  const m = mapType(t);
  return m === 'NUMBER' ? 0 : m === 'BOOLEAN' ? false : '';
};

export const defaultLiteral = (t: string): string => {
  const m = mapType(t);
  return m === 'NUMBER' ? '0' : m === 'BOOLEAN' ? 'false' : '';
};

const coerce = (v: string, t: string): string | number | boolean => {
  const m = mapType(t);
  if (m === 'BOOLEAN') return v === 'true';
  if (m === 'NUMBER') { const n = Number(v); return v.trim() === '' || isNaN(n) ? 0 : n; }
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

export function generateWorkflow(name: string, version: string, nodes: FlowNode[], conns: Connection[]) {
  const ordered = sortNodes(nodes, conns);
  const packages: Record<string, string> = {};
  const variables: Record<string, any> = {};
  const actions: Record<string, any> = {};

  const produced = new Set<string>();
  ordered.forEach(n => Object.values(n.outputs).forEach(v => v.trim() && produced.add(varName(v))));

  ordered.forEach((n, i) => {
    packages[n.pkg.name] = '';

    const inputs: Record<string, any> = {};
    for (const [key, type] of Object.entries(n.action.inputs)) {
      const b = n.inputs[key];
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

    const outputs: Record<string, string> = {};
    for (const [key, type] of Object.entries(n.action.outputs)) {
      const v = varName(n.outputs[key] || `${n.action.name}_${key}_${n.id}`);
      outputs[key] = `{{${v}}}`;
      variables[v] = { value: defaultFor(type), type: mapType(type), input: false, output: true };
    }

    const cls = n.pkg.className ?? CLASS_NAMES[n.pkg.name] ?? n.pkg.name.replace(/\s+/g, '');
    actions[String(i + 1)] = { ClassName: cls, FunctionName: n.action.name, Inputs: inputs, outputs };
  });

  return { flow_name: name, version, packages, variables, Actions: actions };
}

// ───────────────────────────── Component ─────────────────────────────

@Component({
  selector: 'app-flow-builder',
  standalone: true,
  imports: [FormsModule],
  template: `
  <header class="bar">
  <strong>Flow builder</strong>
  <span class="grow"></span>

  <button
    (click)="download()"
    [disabled]="!nodes().length">
    Download JSON
  </button>

  <button
    class="submit-btn"
    (click)="submitWorkflow()"
    [disabled]="!nodes().length || submitting()">
    {{ submitting() ? 'Submitting...' : 'Submit to API' }}
  </button>
</header>

@if (submitMessage()) {
  <div
    class="submit-message"
    [class.success]="submitSuccess()"
    [class.failure]="!submitSuccess()">
    {{ submitMessage() }}
  </div>
}

  <div class="layout">
    <!-- LEFT: actions grouped by package -->
    <aside class="side">
      <input class="search" placeholder="Search actions" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @if (loading()) { <p class="hint">Loading packages…</p> }
      @if (error()) { <p class="err">{{ error() }}</p> }
      @for (g of groups(); track g.pkg.id) {
        <details open>
          <summary>{{ g.pkg.name }} <small>v{{ g.pkg.version }}</small></summary>
          @for (a of g.actions; track a.id) {
            <div class="item" draggable="true"
                 (dragstart)="onDragStart($event, g.pkg, a)"
                 (dblclick)="addNode(g.pkg, a, 60 + nodes().length * 30, 60 + nodes().length * 30)"
                 [title]="'Drag onto the canvas (or double-click)'">
              {{ a.name }}
              <small>{{ keys(a.inputs).length }} in · {{ keys(a.outputs).length }} out</small>
            </div>
          }
        </details>
      }
    </aside>

    <!-- CENTER: canvas -->
    <main class="canvas" (dragover)="$event.preventDefault()" (drop)="onDrop($event)" (pointerdown)="selectedId.set(null)">
      <div class="surface" #surface>
        <svg class="wires">
          @for (c of connections(); track c.id) {
            <path class="wire-hit" [attr.d]="path(c)" (click)="removeConnection(c.id)" />
            <path class="wire" [attr.d]="path(c)" />
          }
          @if (pending(); as p) { <path class="wire temp" [attr.d]="pendingPath()" /> }
        </svg>

        @for (n of nodes(); track n.id) {
          <div class="node" [class.sel]="n.id === selectedId()" [style.left.px]="n.x" [style.top.px]="n.y"
               [style.width.px]="NODE_W" (pointerdown)="$event.stopPropagation(); select(n.id)">
            <div class="port in" title="Drop a connection here" (pointerup)="finishConnect(n.id)"></div>
            <div class="head" (pointerdown)="startDrag($event, n)">
              <span class="step">{{ orderOf(n.id) }}</span>
              <span class="title"><b>{{ n.action.name }}</b><small>{{ n.pkg.name }}</small></span>
            </div>
            <div class="body">
              @for (k of keys(n.action.inputs); track k) {
                <div class="row"><span>{{ k }}</span><em>{{ n.action.inputs[k] }}</em></div>
              }
            </div>
            <div class="port out" title="Drag to another node" (pointerdown)="startConnect($event, n)"></div>
          </div>
        }

        @if (!nodes().length) {
          <div class="empty">Drag an action from the left panel to start your flow.<br>Drag from a node's right dot to the next node's left dot to set the run order.</div>
        }
      </div>
    </main>

    <!-- RIGHT: properties / JSON -->
    <aside class="side right">
      <div class="tabs">
        <button [class.on]="tab() === 'props'" (click)="tab.set('props')">Properties</button>
        <button [class.on]="tab() === 'json'" (click)="tab.set('json')">Workflow JSON</button>
      </div>

      @if (tab() === 'props') {
        <label>Flow name <input [ngModel]="flowName()" (ngModelChange)="flowName.set($event)" /></label>
        <label>Version <input [ngModel]="flowVersion()" (ngModelChange)="flowVersion.set($event)" /></label>
        <hr />

        @if (selected(); as n) {
          <h4>{{ n.action.name }} <small>{{ n.pkg.name }}</small></h4>
          <h5>Inputs</h5>
          @for (k of keys(n.action.inputs); track k) {
            @let b = n.inputs[k];
            <div class="field">
              <div class="flabel">{{ k }} <small>{{ mapType(n.action.inputs[k]) }}</small></div>
              <div class="inline">
                <select [ngModel]="b.mode" (ngModelChange)="set(b, 'mode', $event)">
                  <option value="literal">Value</option>
                  <option value="variable">Variable</option>
                </select>
                @if (b.mode === 'literal' && mapType(n.action.inputs[k]) === 'BOOLEAN') {
                  <select [ngModel]="b.value" (ngModelChange)="set(b, 'value', $event)">
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                } @else {
                  <input [placeholder]="b.mode === 'variable' ? 'variable name' : 'value'"
                         [ngModel]="b.value" (ngModelChange)="set(b, 'value', $event)" />
                }
              </div>
              @if (b.mode === 'variable') {
                <input class="sub" placeholder="initial value of variable" [ngModel]="b.varValue" (ngModelChange)="set(b, 'varValue', $event)" />
              }
            </div>
          }
          <h5>Outputs → variable</h5>
          @for (k of keys(n.action.outputs); track k) {
            <div class="field">
              <div class="flabel">{{ k }} <small>{{ mapType(n.action.outputs[k]) }}</small></div>
              <input [ngModel]="n.outputs[k]" (ngModelChange)="n.outputs[k] = $event; touch()" />
            </div>
          }
          <button class="danger" (click)="removeNode(n.id)">Delete action</button>
        } @else {
          <p class="hint">Select an action on the canvas to edit its inputs and outputs. Click a wire to delete it.</p>
        }
      } @else {
        <div class="inline"><button (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button></div>
        <pre class="json">{{ json() }}</pre>
      }
    </aside>
  </div>
  `,
  styles: [`
    :host { display:flex; flex-direction:column; height:100vh; font:13px/1.4 "Segoe UI", system-ui, sans-serif; color:#1d2433;
      --ink:#1d2433; --muted:#6b7385; --line:#d9dde6; --paper:#f4f5f8; --accent:#2457d6; --accent-soft:#e6edfd; }
    .bar { display:flex; align-items:center; gap:12px; padding:8px 14px; background:#fff; border-bottom:1px solid var(--line); }
    .grow { flex:1; }
    .layout { flex:1; display:grid; grid-template-columns:240px 1fr 320px; min-height:0; }
    .side { background:#fff; border-right:1px solid var(--line); padding:10px; overflow:auto; }
    .side.right { border-right:0; border-left:1px solid var(--line); }
    input, select, button { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--ink); min-width:0; }
    input:focus-visible, select:focus-visible, button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
    button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
    .search, label input { width:100%; box-sizing:border-box; }
    label { display:block; margin-bottom:8px; color:var(--muted); } label input { margin-top:3px; color:var(--ink); }
    summary { cursor:pointer; font-weight:600; padding:8px 2px; } summary small, h4 small, .flabel small, .item small { color:var(--muted); font-weight:400; margin-left:6px; }
    .item { display:flex; justify-content:space-between; align-items:center; padding:7px 9px; margin:3px 0; border:1px solid var(--line); border-radius:6px; background:var(--paper); cursor:grab; }
    .item:hover { border-color:var(--accent); background:var(--accent-soft); }
    .hint { color:var(--muted); } .err { color:#b42318; }
    .canvas { overflow:auto; background:var(--paper); }
    .surface { position:relative; width:3000px; height:2000px;
      background-image:radial-gradient(#c3c8d4 1px, transparent 1px); background-size:20px 20px; }
    .wires { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
    .wire { fill:none; stroke:var(--accent); stroke-width:2; }
    .wire.temp { stroke-dasharray:5 4; }
    .wire-hit { fill:none; stroke:transparent; stroke-width:14; pointer-events:stroke; cursor:pointer; }
    .node { position:absolute; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 1px 3px rgba(20,30,60,.12); }
    .node.sel { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft), 0 1px 3px rgba(20,30,60,.12); }
    .head { height:44px; box-sizing:border-box; display:flex; align-items:center; gap:8px; padding:0 12px; cursor:move; border-bottom:1px solid var(--line); user-select:none; }
    .step { width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff; display:grid; place-items:center; font-size:11px; flex:none; }
    .title { display:flex; flex-direction:column; min-width:0; } .title small { color:var(--muted); }
    .body { padding:6px 12px 8px; } .row { display:flex; justify-content:space-between; gap:8px; color:var(--muted); font-size:12px; } .row em { font-style:normal; opacity:.7; }
    .port { position:absolute; top:15px; width:14px; height:14px; border-radius:50%; background:#fff; border:2px solid var(--accent); }
    .port.in { left:-8px; } .port.out { right:-8px; cursor:crosshair; } .port:hover { background:var(--accent); }
    .empty { position:absolute; left:80px; top:80px; color:var(--muted); max-width:360px; }
    .tabs { display:flex; gap:4px; margin-bottom:10px; } .tabs button { flex:1; } .tabs .on { background:var(--accent); color:#fff; border-color:var(--accent); }
    h4 { margin:4px 0; } h5 { margin:12px 0 4px; color:var(--muted); font-weight:600; }
    .field { margin-bottom:8px; } .flabel { margin-bottom:3px; } .inline { display:flex; gap:6px; } .inline input { flex:1; } .sub { width:100%; box-sizing:border-box; margin-top:4px; }
    hr { border:0; border-top:1px solid var(--line); margin:10px 0; }
    .danger { margin-top:12px; color:#b42318; border-color:#f0c4bf; }
    .json { background:#10162a; color:#d6e1ff; padding:10px; border-radius:8px; overflow:auto; font:12px/1.45 Consolas, monospace; max-height:calc(100vh - 150px); }
    @media (max-width:1000px) { .layout { grid-template-columns:200px 1fr 260px; } }
  `],
})
export class FlowBuilderComponent implements OnInit {
  private http = inject(HttpClient);
  private surface = viewChild.required<ElementRef<HTMLElement>>('surface');


  submitting = signal(false);
submitMessage = signal('');
submitSuccess = signal(false);

submitWorkflow(): void {
  if (this.submitting()) {
    return;
  }

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

  // Generate the workflow JSON from the current canvas.
  const workflow = generateWorkflow(
    flowName,
    flowVersion,
    this.nodes(),
    this.connections()
  );

  this.submitting.set(true);
  this.submitMessage.set('');

  this.http.post(
    WORKFLOW_UPLOAD_URL,
    workflow
  ).subscribe({
    next: (response: any) => {
      this.submitSuccess.set(true);

      this.submitMessage.set(
        response?.message ??
        response?.Message ??
        'Workflow submitted successfully.'
      );

      this.submitting.set(false);
    },

    error: (error) => {
      this.submitSuccess.set(false);

      if (error.status === 409) {
        this.submitMessage.set(
          error.error?.error ??
          `Workflow '${flowName}' version '${flowVersion}' already exists.`
        );
      } else if (error.status === 0) {
        this.submitMessage.set(
          'Unable to connect to the API. Check the server and HTTPS certificate.'
        );
      } else {
        this.submitMessage.set(
          error.error?.error ??
          error.error?.message ??
          `Failed to submit workflow. HTTP status: ${error.status}`
        );
      }

      this.submitting.set(false);
    }
  });
}

  readonly NODE_W = 220;
  readonly PORT_Y = 22;
  readonly mapType = mapType;

  packages = signal<BotPackage[]>([]);
  loading = signal(true);
  error = signal('');
  search = signal('');
  flowName = signal('My Flow');
  flowVersion = signal('1.0.0');
  nodes = signal<FlowNode[]>([]);
  connections = signal<Connection[]>([]);
  selectedId = signal<number | null>(null);
  tab = signal<'props' | 'json'>('props');
  pending = signal<{ from: number; x: number; y: number } | null>(null);
  copied = signal(false);

  private seq = 1;
  private dragging: { n: FlowNode; dx: number; dy: number } | null = null;

  groups = computed(() => {
    const q = this.search().toLowerCase().trim();
    return this.packages()
      .map(pkg => ({ pkg, actions: pkg.actions.filter(a => !q || a.name.toLowerCase().includes(q) || pkg.name.toLowerCase().includes(q)) }))
      .filter(g => g.actions.length);
  });
  selected = computed(() => this.nodes().find(n => n.id === this.selectedId()) ?? null);
  order = computed(() => sortNodes(this.nodes(), this.connections()).map(n => n.id));
  json = computed(() => JSON.stringify(generateWorkflow(this.flowName(), this.flowVersion(), this.nodes(), this.connections()), null, 2));

  ngOnInit() {
    this.http.get<BotPackage[]>(API_URL).subscribe({
      next: p => { this.packages.set(p); this.loading.set(false); },
      error: e => { this.error.set('Could not load packages: ' + (e.message ?? e.statusText)); this.loading.set(false); },
    });
  }

  keys = (o: object) => Object.keys(o);
  orderOf = (id: number) => this.order().indexOf(id) + 1;
  touch() { this.nodes.update(n => [...n]); }
  set(b: Binding, field: keyof Binding, v: string) { (b as any)[field] = v; this.touch(); }
  select(id: number) { this.selectedId.set(id); this.tab.set('props'); }

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
    this.addNode(pkg, action, p.x - this.NODE_W / 2, p.y - 20);
  }

  addNode(pkg: BotPackage, action: PackageAction, x: number, y: number) {
    const id = this.seq++;
    const inputs: Record<string, Binding> = {};
    this.keys(action.inputs).forEach(k => (inputs[k] = { mode: 'literal', value: defaultLiteral(action.inputs[k]), varValue: '' }));
    const outputs: Record<string, string> = {};
    this.keys(action.outputs).forEach(k => (outputs[k] = `${action.name}_${k}_${id}`));
    this.nodes.update(n => [...n, { id, x: Math.max(0, x), y: Math.max(0, y), pkg, action, inputs, outputs }]);
    this.select(id);
  }

  removeNode(id: number) {
    this.nodes.update(n => n.filter(x => x.id !== id));
    this.connections.update(c => c.filter(x => x.from !== id && x.to !== id));
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
    if (exists || this.reaches(toId, p.from)) return; // no duplicates, no cycles
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

  // ---- wires
  path(c: Connection) {
    const a = this.nodes().find(n => n.id === c.from), b = this.nodes().find(n => n.id === c.to);
    return a && b ? this.curve(a.x + this.NODE_W, a.y + this.PORT_Y, b.x, b.y + this.PORT_Y) : '';
  }
  pendingPath() {
    const p = this.pending(); const a = p && this.nodes().find(n => n.id === p.from);
    return p && a ? this.curve(a.x + this.NODE_W, a.y + this.PORT_Y, p.x, p.y) : '';
  }
  private curve(x1: number, y1: number, x2: number, y2: number) {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  private toSurface(e: { clientX: number; clientY: number }) {
    const r = this.surface().nativeElement.getBoundingClientRect(); // already accounts for scroll
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
