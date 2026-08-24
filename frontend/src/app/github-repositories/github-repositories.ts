import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { NavbarComponent } from "../navbar-component/navbar-component";


interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface RepositoryRecord {
  id: string;
  gitHubRepoId: number;
  name: string;
  fullName: string;
  description: string | null;
  html_url: string;
  isPrivate: boolean;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  repoUpdatedAt: string | null;
  fetchedAt: string;
}


@Component({
  selector: 'app-github-repositories',
  imports: [NavbarComponent],
  templateUrl: './github-repositories.html',
  styleUrl: './github-repositories.css',
})
export class GithubRepositories implements OnInit {

   private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  API_BASE = 'https://localhost:5002/api';

  // =========================================================
  // Admin
  // =========================================================

  isAdmin = signal(false);

  private computeIsAdmin(): boolean {
    const role = localStorage.getItem('role');

    return !!role &&
      role.trim().toLowerCase() === 'admin';
  }

  private refreshAdminStatus(): void {
    this.isAdmin.set(this.computeIsAdmin());
  }

  // =========================================================
  // Navigation (sidebar unchanged — see diff notes)
  // =========================================================

  readonly navItems: NavItem[] = [
    {
      key: 'users',
      label: 'Users',
      icon: 'M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 100-8 4 4 0 000 8z'
    },
    {
      key: 'department',
      label: 'Department',
      icon: 'M4 21V9l8-6 8 6v12h-6v-6H10v6H4z'
    },
    {
      key: 'schedules',
      label: 'Schedules',
      icon: 'M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 8H5v10h14V10z'
    },
    {
      key: 'history',
      label: 'History',
      icon: 'M13 3a9 9 0 100 18 9 9 0 000-18zm1 9V6h-2v7l5.2 3.1 1-1.6L14 12z'
    },
    {
      key: 'repositories',
      label: 'Repositories',
      icon: 'M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.5v-1.75c-2.78.62-3.37-1.37-3.37-1.37-.46-1.2-1.11-1.52-1.11-1.52-.9-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.58 2.34 1.12 2.91.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.9-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.9v2.82c0 .28.18.6.69.5A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z'
    }
  ];

  select(key: string): void {
    switch (key) {

      case 'users':
        this.router.navigate(['/admin']);
        break;

      case 'department':
        this.router.navigate(['/departments']);
        break;

      case 'schedules':
        this.router.navigate(['/schedules']);
        break;

      case 'history':
        this.router.navigate(['/history']);
        break; case 'repositories':
        this.router.navigate(['/git/repos1']);
        break;
    }
  }

  // =========================================================
  // Repositories
  // =========================================================

  repositories = signal<RepositoryRecord[]>([]);

  loading = signal(false);

  error = signal<string | null>(null);

  // =========================================================
  // Lifecycle
  // =========================================================

  ngOnInit(): void {
    this.refreshAdminStatus();
    this.loadRepositories();
  }

  // =========================================================
  // Authentication
  // =========================================================

  private getAuthHeaders(): HttpHeaders {

    const token = localStorage.getItem('auth_token');

    let headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });

    if (token) {
      headers = headers.set(
        'Authorization',
        `Bearer ${token}`
      );
    }

    return headers;
  }

  // =========================================================
  // Load repositories
  // =========================================================

  loadRepositories(): void {

    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<RepositoryRecord[]>(
        `https://localhost:5002/api/GitHub/repositories`,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {

          console.error(
            'Failed to load repositories:',
            err
          );

          this.error.set(
            err?.error?.message ||
            err?.error?.title ||
            'Failed to load repositories.'
          );

          return of([] as RepositoryRecord[]);
        }),

        finalize(() => {
          this.loading.set(false);
        })
      )
      .subscribe(repositories => {

        console.log(repositories);
        this.repositories.set(repositories);
      });
  }

  // =========================================================
  // Retry
  // =========================================================

  retry(): void {
    this.loadRepositories();
  }
}
