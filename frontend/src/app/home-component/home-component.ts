import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../auth-service';
import { NavbarComponent } from "../navbar-component/navbar-component";

interface ExecutionHistoryItem {
  executionId: number;
  processId: string;
  processName: string;
  triggeredUserId: string;
  triggeredUserName: string;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  status: string; // 'Running' | 'Completed' | 'Failed' (server-defined)
  remarks: string;
  errorMessage: string | null;
  triggerType: string;
  executionMode: string;
  createdAt: string;
}

interface HistoryResponse {
  items: ExecutionHistoryItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface StatCard {
  title: string;
  value: string;
  icon: string;
  route: string;
}

interface RecentActivity {
  name: string;
  status: string;
  statusClass: 'completed' | 'running' | 'failed';
  time: string;
}

const API_BASE = 'https://localhost:5002/api'; // match other components' API_BASE / adjust port if needed
const RECENT_ACTIVITY_LIMIT = 4;

@Component({
  selector: 'app-home-component',
  imports: [CommonModule, RouterLink, NavbarComponent],
  templateUrl: './home-component.html',
  styleUrl: './home-component.css',
})
export class HomeComponent {

  private http = inject(HttpClient);

  username = signal('');

  historyLoading = signal(false);
  historyError = signal<string | null>(null);

  completedCount = signal(0);
  runningCount = signal(0);
  failedCount = signal(0);
  totalExecutions = signal(0);

  recentActivities = signal<RecentActivity[]>([]);

  stats = signal<StatCard[]>([
    { title: 'Total Executions', value: '0', icon: '🔄', route: '/jobs' },
    { title: 'Running Bots', value: '0', icon: '▶', route: '/jobs' },
    { title: 'Completed', value: '0', icon: '✓', route: '/jobs' },
    { title: 'Failed', value: '0', icon: '⚠', route: '/jobs' },
  ]);

  quickActions = [
    {
      title: 'Create Workflow',
      description: 'Build a new automation workflow',
      icon: '＋',
      route: '/workflow'
    },
    {
      title: 'Run Bot',
      description: 'Execute an existing automation',
      icon: '▶',
      route: '/jobs'
    },
    {
      title: 'Upload File',
      description: 'Upload files for processing',
      icon: '↑',
      route: '/upload'
    },
    {
      title: 'View Jobs',
      description: 'Check automation execution status',
      icon: '☷',
      route: '/jobs'
    }
  ];

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    const storedUsername = localStorage.getItem('username');

    if (!storedUsername) {
      this.router.navigate(['/login']);
      return;
    }

    this.username.set(storedUsername);

    this.loadHistory();
  }

  loadHistory(): void {
    this.historyLoading.set(true);
    this.historyError.set(null);

    this.http.get<HistoryResponse>(
      `${API_BASE}/History`,
      { params: { page: 1, pageSize: 10 } }
    ).pipe(
      catchError(err => {
        this.historyError.set(err?.error?.message || 'Failed to load execution history.');
        return of(null);
      })
    ).subscribe(result => {
      this.historyLoading.set(false);

      if (!result) {
        return;
      }

      this.applyHistory(result);
    });
  }

  private applyHistory(result: HistoryResponse): void {
    const items = result.items ?? [];

    let completed = 0;
    let running = 0;
    let failed = 0;

    for (const item of items) {
      switch (this.normalizeStatus(item.status)) {
        case 'completed':
          completed++;
          break;
        case 'running':
          running++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    this.completedCount.set(completed);
    this.runningCount.set(running);
    this.failedCount.set(failed);
    this.totalExecutions.set(result.totalCount);

    this.stats.set([
      { title: 'Total Executions', value: String(result.totalCount), icon: '🔄', route: '/jobs' },
      { title: 'Running Bots', value: String(running), icon: '▶', route: '/jobs' },
      { title: 'Completed', value: String(completed), icon: '✓', route: '/jobs' },
      { title: 'Failed', value: String(failed), icon: '⚠', route: '/jobs' },
    ]);

    this.recentActivities.set(
      items
        .slice(0, RECENT_ACTIVITY_LIMIT)
        .map(item => ({
          name: item.processName,
          status: this.displayStatus(item.status),
          statusClass: this.normalizeStatus(item.status),
          time: this.relativeTime(item.startTime),
        }))
    );
  }

  private normalizeStatus(status: string): 'completed' | 'running' | 'failed' {
    const s = (status || '').toLowerCase();

    if (s === 'failed') return 'failed';
    if (s === 'running') return 'running';

    // Treat anything else (Completed, Success, Passed, etc.) as completed
    return 'completed';
  }

  private displayStatus(status: string): string {
    return status || 'Unknown';
  }

  private relativeTime(isoTime: string): string {
    const start = new Date(isoTime).getTime();

    if (Number.isNaN(start)) {
      return '';
    }

    const diffMs = Date.now() - start;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) {
      return 'Just now';
    }

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    }

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) {
      return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
    }

    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  }

  retryHistory(): void {
    this.loadHistory();
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  getInitials(name: string): string {
    if (!name) {
      return 'U';
    }

    const parts = name.trim().split(' ');

    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }

    return (
      parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  }
}
