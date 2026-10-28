import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

// Tip: use a dev proxy (proxy.conf.json: "/api" -> https://localhost:5000, secure:false)
// and set this to '/api/Packages' to avoid CORS / self-signed cert issues.
const API_URL = 'https://localhost:5000/api/Packages';

const WORKFLOW_UPLOAD_URL =
  'https://localhost:5000/api/Workflows/upload';
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
  templateUrl: './flow-builder.html',
  styleUrl: './flow-builder.css',
})
export class FlowBuilderComponent implements OnInit {
  private http = inject(HttpClient);
  private surface = viewChild.required<ElementRef<HTMLElement>>('surface');

  submitting = signal(false);
  submitMessage = signal('');
  submitSuccess = signal(false);
libraryOpen = signal(true);
panelOpen   = signal(true);
zoom        = signal(1);

zoomIn()  { this.zoom.update(z => Math.min(2, +(z + 0.1).toFixed(2))); }
zoomOut() { this.zoom.update(z => Math.max(0.4, +(z - 0.1).toFixed(2))); }
fit()     { this.zoom.set(1); }
back()    { history.back(); }   // or router.navigate(...)

private readonly ACCENTS = ['#0f62d6', '#107c41', '#7a3fb0', '#c4562b', '#0b7a8c'];
accentOf(pkgId: string | number): string {
  const s = String(pkgId);
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return this.ACCENTS[h % this.ACCENTS.length];
}
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
setOutput(n: FlowNode, key: string, value: string) {
  n.outputs[key] = value;
  this.touch();
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
