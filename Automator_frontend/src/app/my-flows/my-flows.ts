import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, signal, untracked } from '@angular/core';
import { Workflow } from '../workflow';
import { debounceTime, distinctUntilChanged, map, Subscription } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

export interface WorkflowResponse {
  id: number;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
}


@Component({
  imports: [DatePipe,RouterLink],
  selector: 'app-my-flows',
  styleUrl: './my-flows.css',
  templateUrl: './my-flows.html',
})
export class MyFlows implements OnDestroy {
  private readonly workflowService = inject(Workflow);
  private subscription?: Subscription;

  // What the user has typed (updates instantly so the input stays responsive)
  readonly searchText = signal('');
  readonly latestOnly = signal(false);

  // The search text that is actually sent to the API, 300 ms after typing stops
  private readonly appliedName = toSignal(
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

  readonly hasFilters = computed(() => this.appliedName() !== '' || this.latestOnly());

  constructor() {
    // Runs once on start and again whenever the applied name or the checkbox changes
    effect(() => {
      const name = this.appliedName();
      const latestOnly = this.latestOnly();
      untracked(() => this.load(name, latestOnly));
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  load(name: string = this.appliedName(), latestOnly: boolean = this.latestOnly()): void {
    // Cancel any in-flight request so an older response can't overwrite a newer one
    this.subscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    this.subscription = this.workflowService.getAll(name, latestOnly).subscribe({
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
    this.searchText.set((event.target as HTMLInputElement).value);
  }

  onLatestOnlyChange(event: Event): void {
    this.latestOnly.set((event.target as HTMLInputElement).checked);
  }

  clearFilters(): void {
    this.searchText.set('');
    this.latestOnly.set(false);
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Cannot reach the server.';
    const body = err.error;
    if (typeof body === 'string' && body.length > 0) return body;
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return 'Could not load flows.';
  }
}
