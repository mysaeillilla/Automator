import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { NavbarComponent } from "../navbar-component/navbar-component";
import { PanelKey, Sidebar } from "../sidebar/sidebar";

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
  imports: [NavbarComponent, Sidebar],
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
  // Navigation (delegated to <app-sidebar>)
  // =========================================================

  selected = signal<PanelKey>('github-repo');

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

  cloneRepository(repo : any){



  }

cloning(){

  return false;

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
