import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, map, Subscription } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { Workflow } from '../workflow';
import { environment } from '../../environments/environment.development';

export interface WorkflowResponse {
  id: number;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
}

interface WorkflowExecutionResponse {
  executionId: string;
  workflowId: number;
  workflowName: string;
  workflowVersion: string;
  status: string;
  statusUrl: string;
}

@Component({
  selector: 'app-my-flows',
  imports: [DatePipe, RouterLink],
  styleUrl: './my-flows.css',
  templateUrl: './my-flows.html',
})
export class MyFlows implements OnDestroy {
  private readonly workflowService = inject(Workflow);
  private readonly http = inject(HttpClient);

  private subscription?: Subscription;
private router = inject(Router);
  readonly searchText = signal('');
  readonly latestOnly = signal(false);

  readonly runningId = signal<number | null>(null);
  readonly executionMessage = signal('');
  readonly executionError = signal(false);
  readonly executionId = signal<string | null>(null);
  readonly executionStatus = signal<string | null>(null);

  readonly appliedName = toSignal(
    toObservable(this.searchText).pipe(
      map((text) => text.trim()),
      debounceTime(300),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  readonly flows = signal<WorkflowResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasFilters = computed(
    () => this.appliedName() !== '' || this.latestOnly(),
  );

  constructor() {
    effect(() => {
      const name = this.appliedName();
      const latestOnly = this.latestOnly();

      untracked(() => this.load(name, latestOnly));
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  load(
    name: string = this.appliedName(),
    latestOnly: boolean = this.latestOnly(),
  ): void {
    this.subscription?.unsubscribe();

    this.loading.set(true);
    this.error.set(null);

    this.subscription = this.workflowService
      .getAll(name, latestOnly)
      .subscribe({
        next: (flows) => {
          this.flows.set(flows);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(this.toMessage(err));
          this.loading.set(false);
        },
      });
  }

  onSearch(event: Event): void {
    this.searchText.set(
      (event.target as HTMLInputElement).value,
    );
  }

  onLatestOnlyChange(event: Event): void {
    this.latestOnly.set(
      (event.target as HTMLInputElement).checked,
    );
  }

  clearFilters(): void {
    this.searchText.set('');
    this.latestOnly.set(false);
  }

  runFlow(flow: WorkflowResponse): void {
    if (this.runningId() !== null) {
      return;
    }

    this.runningId.set(flow.id);
    this.executionMessage.set('');
    this.executionError.set(false);
    this.executionId.set(null);
    this.executionStatus.set(null);
     const baseUrl = `${environment.apiUrl}`;
    const url =
      `${baseUrl}/api/WorkflowExecution/execute/${flow.id}`;

    this.http.post<WorkflowExecutionResponse>(url, '').subscribe({
      next: (response) => {
        this.runningId.set(null);
        this.executionId.set(response.executionId);
        this.executionStatus.set(response.status);
        this.executionMessage.set(
          `Execution started for ${response.workflowName} ` +
          `(v${response.workflowVersion}).`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.runningId.set(null);
        this.executionError.set(true);

        if (err.status === 0) {
          this.executionMessage.set(
            'Cannot connect to the execution API. Check the API server, ' +
            'HTTPS certificate, and CORS configuration.',
          );
        } else {
          this.executionMessage.set(
            err.error?.error ??
            err.error?.detail ??
            `Failed to start workflow. HTTP status: ${err.status}.`,
          );
        }
      },
    });
  }

  editFlow(flow: WorkflowResponse): void {
    // Dummy edit function. Replace with editor navigation later.
    console.log('Edit workflow:', flow);
    alert(`Edit Flow clicked for "${flow.name}" (ID: ${flow.id}).`);

    this.router.navigate(['/myflows', flow.id]);
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) {
      return 'Cannot reach the server.';
    }

    const body = err.error;

    if (typeof body === 'string' && body.length > 0) {
      return body;
    }

    if (body?.detail) {
      return body.detail;
    }

    if (body?.title) {
      return body.title;
    }

    return 'Could not load flows.';
  }
}
