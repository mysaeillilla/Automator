import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface Department {
  id: string;
  departmentName: string;
  description: string | null;
  createdAt: string;
  userCount: number;
}

interface NewDepartmentForm {
  departmentName: string;
  description: string;
}

const API_BASE = 'http://localhost:5001/api';

@Component({
  selector: 'app-departments',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    FormsModule,RouterLink
  ],
  templateUrl: './departments.html',
  styleUrl: './departments.css'
})
export class Departments implements OnInit {

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

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
  // Navigation
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
    },{ key: 'repositories', label: 'Repositories', icon: 'M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.5v-1.75c-2.78.62-3.37-1.37-3.37-1.37-.46-1.2-1.11-1.52-1.11-1.52-.9-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.58 2.34 1.12 2.91.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.9-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.9v2.82c0 .28.18.6.69.5A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z' }
  ];

  /**
   * Navigate between application sections.
   *
   * Each section is now handled by its own route/component.
   */
  select(key: string): void {
    switch (key) {

      case 'users':
        this.router.navigate(['/admin']);
        break;

      case 'department':
        this.router.navigate(['/department']);
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
  // Departments
  // =========================================================

  departments = signal<Department[]>([]);

  loading = signal(false);

  error = signal<string | null>(null);

  // =========================================================
  // Lifecycle
  // =========================================================

  ngOnInit(): void {
    this.refreshAdminStatus();
    this.loadDepartments();
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
  // Load departments
  // =========================================================

  loadDepartments(): void {

    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<Department[]>(
        `${API_BASE}/Department`,
        {
          headers: this.getAuthHeaders()
        }
      )
      .pipe(
        catchError(err => {

          console.error(
            'Failed to load departments:',
            err
          );

          this.error.set(
            err?.error?.message ||
            err?.error?.title ||
            'Failed to load departments.'
          );

          return of([] as Department[]);
        }),

        finalize(() => {
          this.loading.set(false);
        })
      )
      .subscribe(departments => {
        this.departments.set(departments);
      });
  }

  // =========================================================
  // Create department modal
  // =========================================================

  showDeptModal = signal(false);

  deptFormError = signal<string | null>(null);

  deptFormSubmitting = signal(false);

  newDept: NewDepartmentForm = {
    departmentName: '',
    description: ''
  };

  openDeptModal(): void {

    this.newDept = {
      departmentName: '',
      description: ''
    };

    this.deptFormError.set(null);

    this.showDeptModal.set(true);
  }

  closeDeptModal(): void {

    if (this.deptFormSubmitting()) {
      return;
    }

    this.showDeptModal.set(false);

    this.deptFormError.set(null);
  }

  onModalBackdropClick(event: MouseEvent): void {

    if (event.target === event.currentTarget) {
      this.closeDeptModal();
    }
  }

  submitNewDepartment(): void {

    if (this.deptFormSubmitting()) {
      return;
    }

    const departmentName =
      this.newDept.departmentName?.trim() ?? '';

    const description =
      this.newDept.description?.trim() ?? '';

    // ---------------------------------------------------------
    // Validation
    // ---------------------------------------------------------

    if (!departmentName) {

      this.deptFormError.set(
        'Department name is required.'
      );

      return;
    }

    if (departmentName.length > 100) {

      this.deptFormError.set(
        'Department name cannot exceed 100 characters.'
      );

      return;
    }

    // ---------------------------------------------------------
    // Duplicate check
    // ---------------------------------------------------------

    const duplicate =
      this.departments().some(
        department =>
          department.departmentName
            .trim()
            .toLowerCase() ===
          departmentName.toLowerCase()
      );

    if (duplicate) {

      this.deptFormError.set(
        'A department with this name already exists.'
      );

      return;
    }

    // ---------------------------------------------------------
    // Submit
    // ---------------------------------------------------------

    this.deptFormSubmitting.set(true);
    this.deptFormError.set(null);

    this.addDepartment(
      departmentName,
      description
    )
      .pipe(
        catchError(err => {

          console.error(
            'Failed to create department:',
            err
          );

          this.deptFormError.set(
            err?.error?.message ||
            err?.error?.title ||
            'Failed to create department.'
          );

          return of(null);
        }),

        finalize(() => {
          this.deptFormSubmitting.set(false);
        })
      )
      .subscribe(result => {

        if (!result) {
          return;
        }

        // Refresh from API so userCount/createdAt/etc.
        // are guaranteed to be current.
        this.loadDepartments();

        this.showDeptModal.set(false);

        this.newDept = {
          departmentName: '',
          description: ''
        };
      });
  }

  addDepartment(
    departmentName: string,
    description: string
  ) {

    return this.http.post<Department>(
      `${API_BASE}/Department`,
      {
        departmentName,
        description
      },
      {
        headers: this.getAuthHeaders()
      }
    );
  }

  // =========================================================
  // Delete department
  // =========================================================

  deletingDepartmentId =
    signal<string | null>(null);

  deleteDepartment(
    id: string,
    event: MouseEvent
  ): void {

    event.preventDefault();
    event.stopPropagation();

    if (this.deletingDepartmentId() === id) {
      return;
    }

    const department =
      this.departments().find(
        d => d.id === id
      );

    const name =
      department?.departmentName ||
      'this department';

    const confirmed = confirm(
      `Are you sure you want to delete "${name}"?`
    );

    if (!confirmed) {
      return;
    }

    this.deletingDepartmentId.set(id);
    this.error.set(null);

    this.http
      .delete(
        `${API_BASE}/Department/${id}`,
        {
          headers: this.getAuthHeaders(),
          responseType: 'text'
        }
      )
      .pipe(

        catchError(err => {

          console.error(
            'Failed to delete department:',
            err
          );

          this.error.set(
            err?.error?.message ||
            err?.error?.title ||
            'Failed to delete department.'
          );

          return of(null);
        }),

        finalize(() => {
          this.deletingDepartmentId.set(null);
        })

      )
      .subscribe(result => {

        if (result !== null) {

          this.departments.update(
            departments =>
              departments.filter(
                department =>
                  department.id !== id
              )
          );
        }
      });
  }

  // =========================================================
  // Retry
  // =========================================================

  retry(): void {
    this.loadDepartments();
  }
}
