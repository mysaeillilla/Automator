import { Component, computed, effect, inject, OnDestroy, signal, untracked } from '@angular/core';
import { JsonBlock, valueToJsonBlock } from '../../utils/format';
import { JsonViewer } from '../json-viewer/json-viewer';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Workflow, WorkflowDetailResponse } from '../workflow';
import { map, Subscription } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';


type Obj = Record<string, unknown>;

interface PackageView {
  name: string;
  path: string;
}

interface VariableView {
  key: string;
  name: string;
  typeLabel: string;
  input: boolean;
  output: boolean;
  preview: string;
  plainValue: string | null;   // set for simple values (text, numbers, booleans)
  valueBlock: JsonBlock | null; // set for arrays and objects
  schema: JsonBlock | null;     // set when the variable's type is an object
}

interface ParamView {
  name: string;
  text: string;
  isReference: boolean; // true for values like {{file_Path}}
}

interface ActionView {
  key: string;
  id: string;
  functionName: string;
  className: string;
  inputs: ParamView[];
  outputs: ParamView[];
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The workflow JSON is hand-written, so key casing varies (Actions, Inputs, outputs...)
function ci(obj: unknown, name: string): unknown {
  if (!isObj(obj)) return undefined;
  const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : obj[key];
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (isObj(value)) {
    const count = Object.keys(value).length;
    return `${count} ${count === 1 ? 'field' : 'fields'}`;
  }
  const text = String(value);
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function toParams(source: unknown): ParamView[] {
  if (!isObj(source)) return [];
  return Object.entries(source).map(([name, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { name, text, isReference: typeof value === 'string' && /\{\{.+?\}\}/.test(value) };
  });
}



@Component({
  imports: [DatePipe, RouterLink, JsonViewer],
  selector: 'app-flow-details',
  styleUrl: './flow-details.css',
  templateUrl: './flow-details.html',
})
export class FlowDetails implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly workflowService = inject(Workflow);
  private subscription?: Subscription;

  private readonly flowId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  readonly detail = signal<WorkflowDetailResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Whole sections (packages, variables, actions, raw) and individual rows
  readonly sectionOpen = signal<Record<string, boolean>>({
    packages: true,
    variables: true,
    actions: true,
    raw: false,
  });
  readonly itemOpen = signal<Record<string, boolean>>({});

  readonly packages = computed<PackageView[]>(() => {
    const packages = ci(this.detail()?.workflow, 'packages');
    if (!isObj(packages)) return [];
    return Object.entries(packages).map(([name, path]) => ({ name, path: String(path) }));
  });

  readonly variables = computed<VariableView[]>(() => {
    const variables = ci(this.detail()?.workflow, 'variables');
    if (!isObj(variables)) return [];

    return Object.entries(variables).map(([name, raw]) => {
      const value = ci(raw, 'value');
      const type = ci(raw, 'type');
      const isComplex = typeof value === 'object' && value !== null;

      return {
        key: `var-${name}`,
        name,
        typeLabel:
          typeof type === 'string' ? type : Array.isArray(value) ? 'TABLE' : 'OBJECT',
        input: ci(raw, 'input') === true,
        output: ci(raw, 'output') === true,
        preview: describe(value),
        plainValue: isComplex ? null : value === '' ? '(empty string)' : String(value),
        valueBlock: isComplex ? valueToJsonBlock(value) : null,
        schema: type === undefined || typeof type === 'string' ? null : valueToJsonBlock(type),
      };
    });
  });

  readonly actions = computed<ActionView[]>(() => {
    const actions = ci(this.detail()?.workflow, 'actions');
    if (!isObj(actions)) return [];

    return Object.entries(actions)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([id, raw]) => ({
        key: `action-${id}`,
        id,
        functionName: String(ci(raw, 'functionname') ?? 'Unnamed action'),
        className: String(ci(raw, 'classname') ?? ''),
        inputs: toParams(ci(raw, 'inputs')),
        outputs: toParams(ci(raw, 'outputs')),
      }));
  });

  readonly rawWorkflow = computed(() => valueToJsonBlock(this.detail()?.workflow));

  constructor() {
    // Reload when the :id in the URL changes
    effect(() => {
      const id = this.flowId();
      untracked(() => {
        this.detail.set(null);
        this.itemOpen.set({});
        this.load(id);
      });
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  load(id: string | null = this.flowId()): void {
    this.subscription?.unsubscribe();

    if (!id) {
      this.error.set('Invalid flow id.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.subscription = this.workflowService.getById(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.toMessage(err));
        this.loading.set(false);
      },
    });
  }

  toggleSection(key: string): void {
    this.sectionOpen.update((current) => ({ ...current, [key]: !current[key] }));
  }

  isSectionOpen(key: string): boolean {
    return !!this.sectionOpen()[key];
  }

  toggleItem(key: string): void {
    this.itemOpen.update((current) => ({ ...current, [key]: !current[key] }));
  }

  isItemOpen(key: string): boolean {
    return !!this.itemOpen()[key];
  }

  expandAll(): void {
    const all: Record<string, boolean> = {};
    for (const variable of this.variables()) all[variable.key] = true;
    for (const action of this.actions()) all[action.key] = true;
    this.sectionOpen.update((current) => ({ ...current, variables: true, actions: true }));
    this.itemOpen.set(all);
  }

  collapseAll(): void {
    this.itemOpen.set({});
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Cannot reach the server.';
    if (err.status === 404) return 'This flow was not found.';
    const body = err.error;
    if (typeof body === 'string' && body.length > 0) return body;
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return 'Could not load the flow.';
  }
}
