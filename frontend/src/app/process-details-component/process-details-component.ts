import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';


interface ProcessDepartment {
  id: string;
  departmentName: string;
}

interface Process {
  id: string;
  processName: string;
  description: string;
  createdAt: string;
  modifiedAt?: string;

  department: ProcessDepartment;

  usersCount: number;
}

interface MyProcessesResponse {
  userId: string;
  count: number;
  processes: Process[];
}

type PanelKey =
  | 'dashboard'
  | 'processes'
  | 'schedules'
  | 'history';

interface NavItem {
  key: PanelKey;
  label: string;
  icon: string;
}

const API_BASE = 'https://localhost:5002/api';



@Component({
  selector: 'app-process-details-component',
  imports: [CommonModule,FormsModule,NavbarComponent,RouterLink],
  templateUrl: './process-details-component.html',
  styleUrl: './process-details-component.css',
})
export class ProcessDetailsComponent {


  private http = inject(HttpClient);
  private router = inject(Router);


  // =========================
  // Navigation
  // =========================

  readonly navItems: NavItem[] = [

    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8v-10h-8v10zm0-18v6h8V3h-8z'
    },

    {
      key: 'processes',
      label: 'Processes',
      icon: 'M4 4h16v4H4V4zm0 6h16v4H4v-4zm0 6h16v4H4v-4z'
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
    }

  ];


  // =========================
  // State
  // =========================

  processes = signal<Process[]>([]);

  loading = signal(false);

  error = signal<string | null>(null);

  userId = signal<string | null>(null);


  // =========================
  // Lifecycle
  // =========================

  ngOnInit(): void {
    this.loadMyProcesses();
  }


  // =========================
  // Load Processes
  // =========================

  loadMyProcesses(): void {

    this.loading.set(true);
    this.error.set(null);


    const token = localStorage.getItem('auth_token');

    if (!token) {

      this.error.set(
        'Authentication token not found. Please log in again.'
      );

      this.loading.set(false);

      return;
    }


    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`
    });


    this.http
      .get<MyProcessesResponse>(
        `${API_BASE}/Process/my-processes`,
        { headers }
      )
      .pipe(

        catchError(err => {

          console.error(
            'Failed to load processes:',
            err
          );

          const message =
            err?.error?.message ||
            'Failed to load your processes.';

          this.error.set(message);

          return of(null);
        })

      )
      .subscribe(result => {

        if (result) {

          this.userId.set(result.userId);

          this.processes.set(
            result.processes ?? []
          );

        } else {

          this.processes.set([]);

        }

        this.loading.set(false);

      });
  }


  // =========================
  // Retry
  // =========================

  retry(): void {
    this.loadMyProcesses();
  }


  // =========================
  // Navigation
  // =========================

  goToPanel(key: PanelKey): void {

    switch (key) {

      case 'dashboard':
        this.router.navigate(['/home']);
        break;

      case 'processes':
        this.router.navigate(['/processes']);
        break;

      case 'schedules':
        this.router.navigate(['/schedules']);
        break;

      case 'history':
        this.router.navigate(['/history']);
        break;

    }
  }


  goBack(): void {
    this.router.navigate(['/']);
  }
}
