import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  forks_count: number;
  stargazers_count: number;
  updated_at: string;
  owner?: {
    login: string;
  };
}

interface GitHubExchangeResponse {
  connected: boolean;
  githubUsername: string | null;
}

@Component({
  selector: 'app-repo-list',
  imports: [],
  templateUrl: './repo-list.html',
  styleUrl: './repo-list.css',
})
export class RepoList implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private apiUrl = 'https://localhost:5002/api/GitHub';

  repositories = signal<GitHubRepository[]>([]);
  loading = signal(true);
  connecting = signal(false);
  errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.handleOAuthRedirectIfPresent();
  }

  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('auth_token');
    return new HttpHeaders({
      Authorization: `Bearer ${token ?? ''}`,
    });
  }

  private handleOAuthRedirectIfPresent(): void {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const state = params.get('state');

    if (code && state) {
      this.loading.set(true);
      this.errorMessage.set(null);

      this.http
        .post<GitHubExchangeResponse>(
          `${this.apiUrl}/exchange`,
          { code, state },
          { headers: this.getAuthHeaders() }
        )
        .pipe(
          catchError((error) => {
            console.error('Unable to complete GitHub authorization', error);
            this.errorMessage.set(
              error?.error?.message ?? 'Could not complete GitHub authorization. Please try again.'
            );
            this.loading.set(false);
            return of(null);
          }),
          switchMap((result) => {
            this.router.navigate([], {
              relativeTo: this.route,
              queryParams: {},
              replaceUrl: true,
            });

            if (result?.connected) {
              return this.fetchRepositories();
            }
            return of(null);
          })
        )
        .subscribe();
    } else {
      this.loadRepositories();
    }
  }

  loadRepositories(): void {
    this.fetchRepositories().subscribe();
  }

  private fetchRepositories() {
    this.loading.set(true);
    this.errorMessage.set(null);

    return this.http
      .get<GitHubRepository[]>(`${this.apiUrl}/repositories`, {
        headers: this.getAuthHeaders(),
      })
      .pipe(
        catchError((error) => {
          console.error('Unable to fetch repositories', error);

          if (error.status === 401) {
            this.errorMessage.set('GitHub not connected or session expired.');
          } else {
            this.errorMessage.set('Unable to load repositories.');
          }

          return of<GitHubRepository[]>([]);
        }),
        switchMap((repositories) => {
          this.repositories.set(repositories ?? []);
          this.loading.set(false);
          return of(repositories);
        })
      );
  }

  // Kicks off the GitHub OAuth flow by fetching the authorization URL
  // from the backend and navigating the browser there.
  connectGitHub(): void {
    this.connecting.set(true);
    this.errorMessage.set(null);

    this.http
      .get<{ url: string }>(`${this.apiUrl}/connect`, { headers: this.getAuthHeaders() })
      .pipe(
        catchError((error) => {
          console.error('Unable to connect GitHub', error);
          this.errorMessage.set('Unable to start GitHub connection.');
          this.connecting.set(false);
          return of(null);
        })
      )
      .subscribe((response) => {
        if (response?.url) {
          window.location.href = response.url;
        } else {
          this.connecting.set(false);
        }
      });
  }

  // =========================================================
  // Display helpers
  // =========================================================

  formatUpdatedAt(isoDate: string): string {
    const updated = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - updated.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;

    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears}y ago`;
  }
}
