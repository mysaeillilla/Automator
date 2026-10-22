import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WorkflowExecutionHistoryService } from '../workflow-execution-history';
import { STATUS_META, WorkflowExecutionSummary } from '../workflow-execution/workflow-execution-module';
import { RunDetails } from '../run-details/run-details';

interface TimeRange {
  key: string;
  label: string;
  hours: number | null;
}

const TIME_RANGES: TimeRange[] = [
  { key: '24h', label: 'Last 24 hours', hours: 24 },
  { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { key: '30d', label: 'Last 30 days', hours: 24 * 30 },
  { key: '90d', label: 'Last 90 days', hours: 24 * 90 },
  { key: 'all', label: 'All time', hours: null },
];

@Component({
  imports: [DatePipe,RunDetails],
  selector: 'app-activity',
  styleUrl: './activity.css',
  templateUrl: './activity.html',
})
export class Activity implements OnInit, OnDestroy {
  private readonly historyService = inject(WorkflowExecutionHistoryService);
  private subscription?: Subscription;

  readonly timeRanges = TIME_RANGES;
  readonly pageSizes = [10, 20, 50, 100];
  readonly statusOptions = Object.entries(STATUS_META).map(([value, meta]) => ({
    value: Number(value),
    label: meta.label,
  }));

  // Filters and paging
  readonly timeRangeKey = signal('90d');
  readonly statusFilter = signal<number | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(20);

  // Data
  readonly runs = signal<WorkflowExecutionSummary[]>([]);
  readonly totalCount = signal(0);
  readonly totalPages = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  readonly rangeEnd = computed(() =>
    Math.min(this.page() * this.pageSize(), this.totalCount()),
  );

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
readonly selectedRunId = signal<string | null>(null);
openRun(id: string): void {
  this.selectedRunId.set(id);
}

closeRun(): void {
  this.selectedRunId.set(null);
}

  load(): void {
    // Cancel any in-flight request so an older response can't overwrite a newer one
    this.subscription?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);

    const range = TIME_RANGES.find((r) => r.key === this.timeRangeKey());
    const fromUtc = range?.hours ? new Date(Date.now() - range.hours * 3_600_000) : null;

    this.subscription = this.historyService
      .getHistory({
        status: this.statusFilter(),
        fromUtc,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (response) => {
          this.runs.set(response.data);
          this.totalCount.set(response.totalCount);
          this.totalPages.set(response.totalPages);
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(this.toMessage(err));
          this.loading.set(false);
        },
      });
  }

  // Filter handlers: always go back to page 1
  onTimeRangeChange(event: Event): void {
    this.timeRangeKey.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
    this.load();
  }

  onStatusChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.statusFilter.set(value === '' ? null : Number(value));
    this.page.set(1);
    this.load();
  }

  onPageSizeChange(event: Event): void {
    this.pageSize.set(Number((event.target as HTMLSelectElement).value));
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.page.set(page);
    this.load();
  }

  // Template helpers
  statusMeta(status: number): { label: string; cssClass: string } {
    return STATUS_META[status] ?? { label: `Unknown (${status})`, cssClass: 'pending' };
  }

  progressPercent(run: WorkflowExecutionSummary): number {
    if (run.totalActions === 0) return 0;
    return Math.round((run.completedActions / run.totalActions) * 100);
  }

  shortId(id: string): string {
    return id.slice(0, 8);
  }

  formatDuration(ms: number | null): string {
    if (ms === null) return '--';
    if (ms < 1000) return `${ms} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${Math.round(seconds % 60)} s`;
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Cannot reach the server.';
    const body = err.error;
    if (typeof body === 'string' && body.length > 0) return body;
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    return 'Could not load activity.';
  }
}
