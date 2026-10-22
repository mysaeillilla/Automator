import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, OnDestroy, output, signal, untracked } from '@angular/core';
import { WorkflowExecutionHistoryService } from '../workflow-execution-history';
import { Subscription } from 'rxjs';
import { getStatusMeta, WorkflowActionExecution, WorkflowExecutionDetail } from '../workflow-execution/workflow-execution-module';
import { formatDuration, JsonBlock, toJsonBlock } from '../../utils/format';
import { DatePipe, NgTemplateOutlet } from '@angular/common';


interface ActionView {
  action: WorkflowActionExecution;
  inputs: JsonBlock | null;
  outputs: JsonBlock | null;
}

interface LogLine {
  time: string | null;
  message: string;
}
function parseLogs(raw: string | null): LogLine[] {
  if (!raw) return [];
  try {
    const lines: unknown = JSON.parse(raw);
    if (!Array.isArray(lines)) return [];
    return lines.map((line) => {
      const text = String(line);
      const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+([\s\S]*)$/.exec(text);
      return match
        ? { time: match[1].replace(/(\.\d{3})\d+/, '$1'), message: match[2] } // keep milliseconds only
        : { time: null, message: text };
    });
  } catch {
    return [];
  }
}

@Component({
  imports: [DatePipe, NgTemplateOutlet],
  selector: 'app-run-details',
  styleUrl: './run-details.css',
  templateUrl: './run-details.html',
})
export class RunDetails implements OnDestroy {
  private readonly historyService = inject(WorkflowExecutionHistoryService);
  private subscription?: Subscription;

  readonly runId = input.required<string>();
  readonly back = output<void>();

  readonly detail = signal<WorkflowExecutionDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly open = signal<Record<string, boolean>>({});
  readonly lastCopied = signal<string | null>(null);

  readonly formatDuration = formatDuration;
  readonly statusMeta = getStatusMeta;

  readonly flowInfo = computed(() => {
    const run = this.detail();
    if (!run) return null;
    try {
      const workflow = JSON.parse(run.workflowJson);
      return { name: workflow.flow_name ?? null, version: workflow.version ?? null };
    } catch {
      return null;
    }
  });

  readonly progress = computed(() => {
    const run = this.detail();
    if (!run || run.totalActions === 0) return 0;
    return Math.round((run.completedActions / run.totalActions) * 100);
  });

  readonly actionViews = computed<ActionView[]>(() => {
    const run = this.detail();
    if (!run) return [];
    return [...run.actions]
      .sort((a, b) => a.sequence - b.sequence)
      .map((action) => ({
        action,
        inputs: toJsonBlock(action.inputsJson),
        outputs: toJsonBlock(action.outputsJson),
      }));
  });

  readonly logs = computed(() => parseLogs(this.detail()?.logsJson ?? null));
  readonly runInputs = computed(() => toJsonBlock(this.detail()?.inputsJson));
  readonly runOutputs = computed(() => toJsonBlock(this.detail()?.outputsJson));
  readonly workflow = computed(() => toJsonBlock(this.detail()?.workflowJson));

  constructor() {
    // Reload whenever the runId input changes
    effect(() => {
      const id = this.runId();
      untracked(() => {
        this.detail.set(null);
        this.open.set({});
        this.load(id);
      });
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  load(id: string = this.runId()): void {
    this.subscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.subscription = this.historyService.getById(id).subscribe({
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

  toggle(key: string): void {
    this.open.update((current) => ({ ...current, [key]: !current[key] }));
  }

  isOpen(key: string): boolean {
    return !!this.open()[key];
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.lastCopied.set(text);
      setTimeout(() => this.lastCopied.set(null), 1500);
    } catch {
      // Clipboard unavailable (permission denied or insecure context)
    }
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Cannot reach the server.';
    if (err.status === 404) return 'This run was not found.';
    const body = err.error;
    if (typeof body === 'string' && body.length > 0) return body;
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return 'Could not load run details.';
  }
}
