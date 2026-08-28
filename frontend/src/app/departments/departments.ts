import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';
import { NavbarComponent } from '../navbar-component/navbar-component';
import { PanelKey, Sidebar } from "../sidebar/sidebar";

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
    FormsModule, RouterLink,
    Sidebar
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
  // Navigation (delegated to <app-sidebar>)
  // =========================================================

  selected = signal<PanelKey>('department');

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
