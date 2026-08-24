import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  owner?: {
    login: string;
  };
}

export interface GitHubStatus {
  connected: boolean;
  githubUsername: string | null;
  connectedAt: string | null;
}

@Component({
  selector: 'app-git-connector',
  imports: [],
  templateUrl: './git-connector.html',
  styleUrl: './git-connector.css',
})
export class GitConnector implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private apiUrl = 'https://localhost:5002/api/github';

  // --- state ---
  isConnected = signal(false);
  githubUsername = signal<string | null>(null);
  repositories = signal<GitHubRepository[]>([]);

  loadingStatus = signal(true);
  loadingRepositories = signal(false);
  connecting = signal(false);
  errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.handleCallbackRedirect();
    this.checkStatus();
  }

  // Builds Authorization headers from the stored JWT
  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('auth_token');
    return new HttpHeaders({
      Authorization: `Bearer ${token ?? ''}`,
    });
  }

  // Catches ?connected=true, ?error=..., and optionally ?token=... coming back
  // from GET /api/github/callback
  private handleCallbackRedirect(): void {
    const params = this.route.snapshot.queryParamMap;
    const error = params.get('error');
    const connected = params.get('connected');
    const token = params.get('token');

    if (token) {
      localStorage.setItem('auth_token', token);
    }

    if (error) {
      this.errorMessage.set(this.mapCallbackError(error));
    } else if (connected === 'true') {
      this.errorMessage.set(null);
    }

    if (error || connected || token) {
      // clean the query params out of the URL without a reload
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  private mapCallbackError(error: string): string {
    switch (error) {
      case 'invalid_state':
        return 'GitHub connection request expired or was invalid. Please try again.';
      case 'token_exchange_failed':
        return 'Could not complete GitHub authorization. Please try again.';
      case 'missing_params':
        return 'GitHub redirected back with missing information. Please try again.';
      default:
        return 'Something went wrong connecting to GitHub.';
    }
  }

  checkStatus(): void {
    this.loadingStatus.set(true);

    this.http
      .get<GitHubStatus>(`${this.apiUrl}/status`, { headers: this.getAuthHeaders() })
      .pipe(
        catchError((error) => {
          console.error('Unable to fetch GitHub status', error);
          this.errorMessage.set('Unable to check GitHub connection status.');
          return of<GitHubStatus>({ connected: false, githubUsername: null, connectedAt: null });
        })
      )
      .subscribe((status) => {
        this.isConnected.set(status.connected);
        this.githubUsername.set(status.githubUsername);
        this.loadingStatus.set(false);

        if (status.connected) {
          this.loadRepositories();
        }
      });
  }

  loadRepositories(): void {
    this.loadingRepositories.set(true);

    this.http
      .get<GitHubRepository[]>(`${this.apiUrl}/repositories`, { headers: this.getAuthHeaders() })
      .pipe(
        catchError((error) => {
          console.error('Unable to fetch repositories', error);

          if (error.status === 401) {
            this.isConnected.set(false);
            this.errorMessage.set('GitHub connection lost. Please reconnect.');
          } else {
            this.errorMessage.set('Unable to load repositories.');
          }

          return of<GitHubRepository[]>([]);
        })
      )
      .subscribe((repositories) => {
        this.repositories.set(repositories);
        this.loadingRepositories.set(false);
      });
  }

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
        }
      });
  }

  disconnectGitHub(): void {
    this.http
      .delete(`${this.apiUrl}/disconnect`, { headers: this.getAuthHeaders() })
      .pipe(
        catchError((error) => {
          console.error('Unable to disconnect GitHub', error);
          this.errorMessage.set('Unable to disconnect GitHub.');
          return of(null);
        })
      )
      .subscribe(() => {
        this.isConnected.set(false);
        this.githubUsername.set(null);
        this.repositories.set([]);
      });
  }
}
