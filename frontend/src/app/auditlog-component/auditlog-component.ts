import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';
import { PanelKey, Sidebar } from "../sidebar/sidebar";

interface ExecutionHistory {
  executionId: number;
  processId: string;
  processName: string;
  triggeredUserId?: string | null;
  triggeredUserName?: string | null;
  startTime: string;
  endTime?: string | null;
  durationMs?: number | null;
  status: string;
  remarks?: string | null;
  errorMessage?: string | null;
  triggerType?: string | null;
  executionMode?: string | null;
  createdAt: string;
}

interface HistoryResponse {
  items: ExecutionHistory[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const API_BASE = 'http://localhost:5001/api';

@Component({
  selector: 'app-auditlog-component',
  standalone: true,
  imports: [CommonModule, NavbarComponent, Sidebar],
  templateUrl: './auditlog-component.html',
  styleUrl: './auditlog-component.css',
})
export class AuditlogComponent implements OnInit {

  private http = inject(HttpClient);
  private router = inject(Router);

  readonly Math = Math;

  isAdmin = signal(localStorage.getItem('role') === 'Admin');

  history = signal<ExecutionHistory[]>([]);

  loading = signal(false);
  error = signal<string | null>(null);
 selected = signal<PanelKey>('history');
  currentPage = signal(1);
  pageSize = signal(10);

  totalCount = signal(0);
  totalPages = signal(0);

  ngOnInit(): void {
    this.loadHistory();
  }

  loadHistory(): void {
    this.loading.set(true);
    this.error.set(null);

    const page = this.currentPage();
    const pageSize = this.pageSize();

    const token = localStorage.getItem('auth_token');

    this.http.get<HistoryResponse>(
      `${API_BASE}/History?page=${page}&pageSize=${pageSize}`,
      {
        headers: token
          ? {
              Authorization: `Bearer ${token}`
            }
          : {}
      }
    ).pipe(
      catchError(err => {
        console.error('Failed to load history:', err);

        this.error.set(
          err?.error?.message ||
          'Failed to load execution history.'
        );

        return of(null);
      })
    ).subscribe(result => {

      this.loading.set(false);

      if (!result) {
        this.history.set([]);
        return;
      }

      this.history.set(result.items ?? []);
      this.currentPage.set(result.page);
      this.pageSize.set(result.pageSize);
      this.totalCount.set(result.totalCount);
      this.totalPages.set(result.totalPages);
    });
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(page => page + 1);
      this.loadHistory();
    }
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(page => page - 1);
      this.loadHistory();
    }
  }

  retry(): void {
    this.loadHistory();
  }

  formatDuration(durationMs: number | null | undefined): string {
    if (durationMs == null) {
      return '-';
    }

    if (durationMs < 1000) {
      return `${durationMs} ms`;
    }

    const seconds = durationMs / 1000;

    if (seconds < 60) {
      return `${seconds.toFixed(1)} s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);

    return `${minutes}m ${remainingSeconds}s`;
  }

  statusClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'success':
      case 'successful':
        return 'status-success';

      case 'failed':
      case 'error':
        return 'status-error';

      case 'running':
        return 'status-running';

      case 'cancelled':
      case 'canceled':
        return 'status-cancelled';

      default:
        return 'status-default';
    }
  }
}
