import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

export type PanelKey = 'users' | 'department' | 'schedules' | 'history' | 'github-repo';
export interface NavItem {
  key: PanelKey;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {

  constructor(private router: Router, private http: HttpClient) {}

  readonly navItems: NavItem[] = [
    { key: 'users', label: 'Users', icon: 'M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 100-8 4 4 0 000 8z' },
    { key: 'department', label: 'Department', icon: 'M4 21V9l8-6 8 6v12h-6v-6H10v6H4z' },
    { key: 'schedules', label: 'Schedules', icon: 'M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 8H5v10h14V10z' },
    { key: 'history', label: 'History', icon: 'M13 3a9 9 0 100 18 9 9 0 000-18zm1 9V6h-2v7l5.2 3.1 1-1.6L14 12z' },
    { key: 'github-repo', label: 'GitHub', icon: 'M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 015.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.68.41.36.78 1.07.78 2.15v3.19c0 .31.21.67.79.55A10.51 10.51 0 0023.5 12c0-6.27-5.23-11.5-11.5-11.5z' },
  ];

  @Input() set active(key: PanelKey) {
    this.selected.set(key);
  }
  @Input() isAdmin = false;

  @Output() selectKey = new EventEmitter<PanelKey>();

  selected = signal<PanelKey>('users');

  select(key: PanelKey): void {
    this.selected.set(key);

    switch (key) {

      case 'users':
        this.router.navigate(['/control-panel']);
        return;
      case 'history':
        this.router.navigate(['/history']);
        return;
      case 'department':
        this.router.navigate(['/departments']);
        return;
      case 'schedules':
        this.router.navigate(['/schedules']);
        return;
      case 'github-repo':
        this.checkGithubAndNavigate();
        return;
      default:
        this.selectKey.emit(key);
    }
  }

  private checkGithubAndNavigate(): void {
    const token = localStorage.getItem('auth_token');
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : undefined;

    this.http.get<{ connected: boolean }>('https://localhost:5002/api/GitHub/status', { headers }).subscribe({
      next: (res) => {
        console.log(res);
        if (res?.connected) {
          this.router.navigate(['/git/repos1']);
        } else {
          this.router.navigate(['/git']);
        }
      },
      error: () => {
        // Endpoint unreachable, errored, or unauthorized — treat as not connected
        this.router.navigate(['/git']);
      },
    });
  }
}
