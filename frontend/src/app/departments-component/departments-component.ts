import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';

interface ProcessUser {
  id: string;
  userName: string;
  role: number;
}

interface Process {
  id: string;
  processName: string;
  description: string;
  processPath?: string;
  createdAt: string;
  modifiedAt?: string;
  users: ProcessUser[];
}

interface ApiDepartment {
  id: string;
  departmentName: string;
  description: string;
  createdAt: string;
  userCount: number;
}

interface DepartmentProcessesResponse {
  departmentId: string;
  departmentName: string;
  processes: Process[];
}

type PanelKey = 'users' | 'department' | 'schedules' | 'history';

interface NavItem {
  key: PanelKey;
  label: string;
  icon: string;
}

const API_BASE = 'https://localhost:5002/api';

@Component({
  selector: 'app-departments-component',
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './departments-component.html',
  styleUrl: './departments-component.css',
})
export class DepartmentsComponent {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  isAdmin = signal(localStorage.getItem('role') === 'Admin');

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
  ];

  selected = signal<PanelKey>('users');

select(key: PanelKey): void {
  if (key === 'history') {
    this.router.navigate(['/history']);
    return;
  }
if (key === 'department') {
    this.router.navigate(['/departments']);
    return;
  }
if (key === 'schedules') {
    this.router.navigate(['/schedules']);
    return;
  }
}

  private roleLabels: Record<number, string> = {
    0: 'Admin',
    1: 'Developer',
    2: 'Creator'
  };

  roleLabel(role: number): string {
    return this.roleLabels[role] ?? `Unknown (${role})`;
  }

  departmentId = signal<string>('');
  department = signal<ApiDepartment | null>(null);

  processes = signal<Process[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  // ===================== CREATE PROCESS =====================

  showProcessModal = signal(false);

  newProcess = {
    processName: '',
    description: ''
  };

  processFormError = signal('');
  processFormSubmitting = signal(false);

  // ===================== TRIGGER PROCESS =====================

  triggerProcessPendingId = signal<string | null>(null);
  triggerProcessError = signal<string | null>(null);

  // ===================== UPLOAD EXE =====================

  @ViewChild('processFileInput')
  processFileInput!: ElementRef<HTMLInputElement>;

  selectedProcessForUpload = signal<Process | null>(null);
  uploadProcessPendingId = signal<string | null>(null);
  uploadProcessError = signal<string | null>(null);

  // ===================== DELETE PROCESS =====================

  deleteProcessPendingId = signal<string | null>(null);

  // ===================== AUTH =====================

  /**
   * Gets the JWT token from localStorage and creates
   * the Authorization header.
   */
  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('auth_token');

    let headers = new HttpHeaders();

    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }

    return headers;
  }

  /**
   * Checks whether the JWT token exists.
   */
  private hasAuthToken(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  // ===================== INIT =====================

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (!id) {
      this.router.navigate(['/admin']);
      return;
    }

    this.departmentId.set(id);

    // Render instantly if we navigated here with state.
    const navState = history.state as {
      department?: ApiDepartment;
    };

    if (navState?.department) {
      this.department.set(navState.department);
    } else {
      this.fetchDepartment(id);
    }

    this.loadProcesses(id);
  }

  // ===================== FETCH DEPARTMENT =====================

  fetchDepartment(id: string): void {
    this.http
      .get<ApiDepartment[]>(
        `${API_BASE}/Department`,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {
          console.error('Fetch department error:', err);
          return of([] as ApiDepartment[]);
        })
      )
      .subscribe(depts => {
        const found = depts.find(d => d.id === id) ?? null;
        this.department.set(found);
      });
  }

  // ===================== LOAD PROCESSES =====================

  loadProcesses(departmentId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<DepartmentProcessesResponse>(
        `${API_BASE}/Process/department/${departmentId}`,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {
          console.error('Load processes error:', err);

          this.error.set(
            err?.error?.message ||
            'Failed to load processes.'
          );

          return of(null);
        })
      )
      .subscribe(result => {
        this.processes.set(result?.processes ?? []);

        // Keep department name fresh if we don't already have department data.
        if (result?.departmentName && !this.department()) {
          this.department.set({
            id: result.departmentId,
            departmentName: result.departmentName,
            description: '',
            createdAt: '',
            userCount: 0
          });
        }

        this.loading.set(false);
      });
  }

  retry(): void {
    this.loadProcesses(this.departmentId());
  }

  // ===================== NAVIGATION =====================

  goBack(): void {
    this.router.navigate(['/departments']);
  }

  goToPanel(key: PanelKey): void {
 this.selected.set(key);

  const routeMap: Record<PanelKey, string> = {
    users: '/users',
    department: '/departments',
    schedules: '/schedules',
    history: '/history'
  };

  this.router.navigate([routeMap[key]]);


    // console.log(key);
    // this.router.navigate(['/departments'], {
    //   state: {
    //     selectedPanel: key
    //   }
    // });


    
  }

  // ===================== CREATE PROCESS =====================

  openProcessModal(): void {
    this.newProcess = {
      processName: '',
      description: ''
    };

    this.processFormError.set('');
    this.showProcessModal.set(true);
  }

  closeProcessModal(): void {
    this.showProcessModal.set(false);
    this.processFormError.set('');
  }

  submitNewProcess(): void {
    if (!this.newProcess.processName.trim()) {
      this.processFormError.set('Process name is required.');
      return;
    }

    if (!this.newProcess.description.trim()) {
      this.processFormError.set('Process description is required.');
      return;
    }

    if (!this.hasAuthToken()) {
      this.processFormError.set(
        'Authentication token not found. Please login again.'
      );
      return;
    }

    this.processFormSubmitting.set(true);
    this.processFormError.set('');

    const body = {
      departmentId: this.departmentId(),
      processName: this.newProcess.processName.trim(),
      description: this.newProcess.description.trim()
    };

    this.http
      .post(
        `${API_BASE}/Process`,
        body,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {
          console.error('Create process error:', err);

          this.processFormError.set(
            err?.error?.message ||
            'Failed to create process.'
          );

          return of(null);
        })
      )
      .subscribe(result => {
        this.processFormSubmitting.set(false);

        if (result !== null) {
          this.closeProcessModal();
          this.loadProcesses(this.departmentId());
        }
      });
  }

  // ===================== TRIGGER PROCESS =====================

  triggerProcess(process: Process): void {
    const confirmed = confirm(
      `Trigger process "${process.processName}"?`
    );

    if (!confirmed) {
      return;
    }

    if (!this.hasAuthToken()) {
      this.triggerProcessError.set(
        'Authentication token not found. Please login again.'
      );
      return;
    }

    this.triggerProcessPendingId.set(process.id);
    this.triggerProcessError.set(null);

    this.http
      .post(
        `${API_BASE}/Process/${process.id}/trigger`,
        {},
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {
          console.error('Trigger process error:', err);

          this.triggerProcessError.set(
            err?.error?.message ||
            'Failed to trigger process.'
          );

          return of(null);
        })
      )
      .subscribe(result => {
        this.triggerProcessPendingId.set(null);

        if (result !== null) {
          alert(
            `Process "${process.processName}" triggered successfully.`
          );
        }
      });
  }

  // ===================== UPLOAD EXE =====================

  uploadProcessExe(process: Process): void {
    this.selectedProcessForUpload.set(process);
    this.uploadProcessError.set(null);

    if (!this.processFileInput) {
      console.error('Process file input is not available.');
      return;
    }

    // Reset the input so selecting the same file again triggers change.
    this.processFileInput.nativeElement.value = '';

    this.processFileInput.nativeElement.click();
  }

  onProcessFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    const process = this.selectedProcessForUpload();

    if (!process) {
      return;
    }

    // Validate extension.
    if (!file.name.toLowerCase().endsWith('.exe')) {
      this.uploadProcessError.set(
        'Only .exe files are allowed.'
      );

      alert('Only .exe files are allowed.');

      input.value = '';
      return;
    }

    const confirmed = confirm(
      `Upload "${file.name}" as the executable for "${process.processName}"?`
    );

    if (!confirmed) {
      input.value = '';
      return;
    }

    if (!this.hasAuthToken()) {
      this.uploadProcessError.set(
        'Authentication token not found. Please login again.'
      );

      alert(
        'Authentication token not found. Please login again.'
      );

      return;
    }

    this.uploadProcessPendingId.set(process.id);
    this.uploadProcessError.set(null);

    const formData = new FormData();
    formData.append('file', file);

    // IMPORTANT:
    // Do not set Content-Type manually for FormData.
    // Angular/browser will automatically set multipart/form-data
    // with the required boundary.
    this.http
      .put(
        `${API_BASE}/Process/${process.id}/executable`,
        formData,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {
          console.error('Upload process EXE error:', err);

          const message =
            err?.error?.message ||
            (typeof err?.error === 'string'
              ? err.error
              : 'Failed to upload executable.');

          this.uploadProcessError.set(message);
          alert(message);

          return of(null);
        })
      )
      .subscribe(result => {
        this.uploadProcessPendingId.set(null);

        if (result !== null) {
          alert('Executable uploaded successfully.');

          // Refresh process list so processPath is updated.
          this.loadProcesses(this.departmentId());
        }
      });
  }

  // ===================== DELETE PROCESS =====================

  deleteProcess(process: Process): void {
    const confirmed = confirm(
      `Delete process "${process.processName}"?`
    );

    if (!confirmed) {
      return;
    }

    /*
     * TODO:
     * Replace this dummy implementation with:
     *
     * this.http.delete(
     *   `${API_BASE}/Process/${process.id}`,
     *   { headers: this.getAuthHeaders() }
     * )
     */

    this.deleteProcessPendingId.set(process.id);

    console.log(
      `[dummy] would DELETE /Process/${process.id}`
    );

    setTimeout(() => {
      this.processes.update(list =>
        list.filter(p => p.id !== process.id)
      );

      this.deleteProcessPendingId.set(null);
    }, 300);
  }
}
