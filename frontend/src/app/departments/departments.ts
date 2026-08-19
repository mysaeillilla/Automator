import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';

type PanelKey = 'users' | 'department' | 'schedules' | 'history';

interface NavItem {
  key: PanelKey;
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
    RouterLink,
    FormsModule
  ],
  templateUrl: './departments.html',
  styleUrl: './departments.css'
})
export class Departments implements OnInit {

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly Math = Math;

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

  readonly activePanel: PanelKey = 'department';

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
    }
  ];

  goToPanel(key: PanelKey): void {
    this.router.navigate(['/admin'], {
      state: {
        selectedPanel: key
      }
    });
  }

  // =========================================================
  // Departments
  // =========================================================

  departments = signal<Department[]>([]);

  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.refreshAdminStatus();
    this.loadDepartments();
  }

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
  // Load
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
    console.log('Opening department modal');

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

    // Validation
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

    // Duplicate check
    const duplicate = this.departments().some(
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

        this.departments.update(
          departments => [
            ...departments,
            result
          ]
        );

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
  // Delete
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

    if (
      !confirm(
        `Are you sure you want to delete "${name}"?`
      )
    ) {
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
            'Failed to delete department.'
          );

          return of(null);
        }),
        finalize(() => {
          this.deletingDepartmentId.set(null);
        })
      )
      .subscribe(result => {

        // If the request did not error,
        // remove it from the UI.
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

  retry(): void {
    this.loadDepartments();
  }
}
