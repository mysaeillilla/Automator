import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { NavbarComponent } from "../navbar-component/navbar-component";
type PanelKey = 'users' | 'department' | 'schedules' | 'history';

interface NavItem {
  key: PanelKey;
  label: string;
  icon: string;
}
export interface Process {
  id: string;
  processName: string;
  description: string;
  createdAt: string;
  modifiedAt: string;

  department?: {
    id: string;
    departmentName: string;
  };

  usersCount?: number;
}

interface NavItem {
  key: PanelKey;
  label: string;
  icon: string;
}

// --- API response shapes ---
interface ApiUser {
  id: string;
  userName: string;
  role: number;
  createdAt: string;
  lastActive: string;
}

interface ApiDepartment {
  id: string;
  departmentName: string;
  description: string;
  createdAt: string;
  userCount: number;
}

enum Role {
  Admin = 0,
  Developer = 1,
  Creator = 2,
}

const ROLE_OPTIONS: { label: string; value: Role }[] = [
  { label: 'Admin', value: Role.Admin },
  { label: 'Developer', value: Role.Developer },
  { label: 'Creator', value: Role.Creator },
];


interface ScheduleRow { id: number; process: string; time: string; frequency: string; nextRun: string; }
interface HistoryRow { id: number; action: string; user: string; timestamp: string; }
const API_BASE = 'https://localhost:5002/api';
@Component({
  selector: 'app-admin-panel',
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './admin-panel.html',
  styleUrl: './admin-panel.css',
})
export class AdminPanel {

    private http = inject(HttpClient);

  readonly navItems: NavItem[] = [
    { key: 'users', label: 'Users', icon: 'M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 100-8 4 4 0 000 8z' },
    { key: 'department', label: 'Department', icon: 'M4 21V9l8-6 8 6v12h-6v-6H10v6H4z' },
    { key: 'schedules', label: 'Schedules', icon: 'M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm12 8H5v10h14V10z' },
    { key: 'history', label: 'History', icon: 'M13 3a9 9 0 100 18 9 9 0 000-18zm1 9V6h-2v7l5.2 3.1 1-1.6L14 12z' },
  ];
expandedDepartmentId = signal<string | null>(null);

departmentProcesses = signal<Record<string, Process[]>>({});

processLoading = signal<Record<string, boolean>>({});

processError = signal<Record<string, string>>({});

showProcessModal = signal(false);

processFormSubmitting = signal(false);

processFormError = signal('');
apiUrl = API_BASE;
activeProcessDepartment = signal<any | null>(null);

newProcess = {
  processName: '',
  description: ''
};

deleteProcessPendingId = signal<string | null>(null);

toggleDepartment(department: any): void {
  const currentId = this.expandedDepartmentId();

  if (currentId === department.id) {
    this.expandedDepartmentId.set(null);
    return;
  }

  this.expandedDepartmentId.set(department.id);

  // Only load if we haven't loaded them already
  if (!this.departmentProcesses()[department.id]) {
    this.loadProcesses(department.id);
  }
}

loadProcesses(departmentId: string): void {
  this.processLoading.update(state => ({
    ...state,
    [departmentId]: true
  }));

  this.processError.update(state => ({
    ...state,
    [departmentId]: ''
  }));

  this.http.post<Process[]>(
    `${this.apiUrl}/Process/list`,
    {
      departmentId: departmentId
    }
  ).subscribe({
    next: (processes) => {
      this.departmentProcesses.update(state => ({
        ...state,
        [departmentId]: processes
      }));

      this.processLoading.update(state => ({
        ...state,
        [departmentId]: false
      }));
    },

    error: (err) => {
      this.processLoading.update(state => ({
        ...state,
        [departmentId]: false
      }));

      this.processError.update(state => ({
        ...state,
        [departmentId]: err?.error?.message || 'Failed to load processes.'
      }));
    }
  });
}

openProcessModal(department: any): void {
  this.activeProcessDepartment.set(department);

  this.newProcess = {
    processName: '',
    description: ''
  };

  this.processFormError.set('');
  this.showProcessModal.set(true);
}

closeProcessModal(): void {
  this.showProcessModal.set(false);
  this.activeProcessDepartment.set(null);
  this.processFormError.set('');
}

submitNewProcess(): void {
  const department = this.activeProcessDepartment();

  if (!department) {
    return;
  }

  if (!this.newProcess.processName.trim()) {
    this.processFormError.set('Process name is required.');
    return;
  }

  if (!this.newProcess.description.trim()) {
    this.processFormError.set('Process description is required.');
    return;
  }

  this.processFormSubmitting.set(true);
  this.processFormError.set('');

  const body = {
    departmentId: department.id,
    processName: this.newProcess.processName.trim(),
    description: this.newProcess.description.trim()
  };

  this.http.post(
    `${this.apiUrl}/Process`,
    body
  ).subscribe({
    next: () => {

      this.processFormSubmitting.set(false);

      this.closeProcessModal();

      // Reload processes for the department
      this.loadProcesses(department.id);
    },

    error: (err) => {
      this.processFormSubmitting.set(false);

      this.processFormError.set(
        err?.error?.message ||
        'Failed to create process.'
      );
    }
  });
}


deleteProcess(process: Process, departmentId: string): void {

  const confirmed = confirm(
    `Are you sure you want to delete "${process.processName}"?`
  );

  if (!confirmed) {
    return;
  }

  this.deleteProcessPendingId.set(process.id);

  this.http.delete(
    `${this.apiUrl}/Process/${process.id}`
  ).subscribe({
    next: () => {

      this.deleteProcessPendingId.set(null);

      // Remove immediately from UI
      this.departmentProcesses.update(state => ({
        ...state,
        [departmentId]: (state[departmentId] || [])
          .filter(p => p.id !== process.id)
      }));
    },

    error: (err) => {

      this.deleteProcessPendingId.set(null);

      alert(
        err?.error?.message ||
        'Failed to delete process.'
      );
    }
  });
}


  readonly roleOptions = ROLE_OPTIONS;

  selected = signal<PanelKey>('users');
  activeLabel = computed(() => this.navItems.find(n => n.key === this.selected())?.label ?? '');

  // Data signals
  users = signal<ApiUser[]>([]);
  departments = signal<ApiDepartment[]>([]);
  schedules = signal<ScheduleRow[]>([]);
  history = signal<HistoryRow[]>([]);

  loading = signal<Record<PanelKey, boolean>>({ users: false, department: false, schedules: false, history: false });
  error = signal<Record<PanelKey, string | null>>({ users: null, department: null, schedules: null, history: null });

  private loaded = new Set<PanelKey>();

  // --- Create User modal state ---
  showUserModal = signal(false);
  newUser = { userName: '', role: Role.Developer, password: '' };
  userFormError = signal<string | null>(null);
  userFormSubmitting = signal(false);

  // --- Create Department modal state ---
  showDeptModal = signal(false);
  newDept = { departmentName: '', description: '' };
  deptFormError = signal<string | null>(null);
  deptFormSubmitting = signal(false);

// ===================== ROLE GATING =====================

  // Read once on component init; localStorage doesn't change reactively,
  // so a signal set at construction is enough here.
  isAdmin = signal(localStorage.getItem('role') === 'Admin');
  showMembersModal = signal(false);
  activeDept = signal<ApiDepartment | null>(null);
  deptMembers = signal<ApiUser[]>([]);
  membersLoading = signal(false);
  memberActionError = signal<string | null>(null);
  memberActionPendingId = signal<string | null>(null); // userId currently being added/removed

  ngOnInit(): void {
    this.loadPanel('users');
  }

  select(key: PanelKey) {
    this.selected.set(key);
    this.loadPanel(key);
  }

  private setLoading(key: PanelKey, value: boolean) {
    this.loading.update(s => ({ ...s, [key]: value }));
  }

  private setError(key: PanelKey, message: string | null) {
    this.error.update(s => ({ ...s, [key]: message }));
  }

  private loadPanel(key: PanelKey, force = false) {
    if (this.loaded.has(key) && !force) return;

    switch (key) {
      case 'users':
        this.fetchUsers();
        break;
      case 'department':
        this.fetchDepartments();
        break;
      case 'schedules':
        this.loaded.add('schedules');
        break;
      case 'history':
        this.loaded.add('history');
        break;
    }
  }

  fetchUsers() {
    this.setLoading('users', true);
    this.setError('users', null);

    this.http.get<ApiUser[]>(`${API_BASE}/Auth`).pipe(
      catchError(err => {
        this.setError('users', 'Failed to load users. Please try again.');
        console.error('fetchUsers error', err);
        return of([] as ApiUser[]);
      })
    ).subscribe(data => {
      this.users.set(data);
      this.setLoading('users', false);
      this.loaded.add('users');
    });
  }

  fetchDepartments() {
    this.setLoading('department', true);
    this.setError('department', null);

    this.http.get<ApiDepartment[]>(`${API_BASE}/Department`).pipe(
      catchError(err => {
        this.setError('department', 'Failed to load departments. Please try again.');
        console.error('fetchDepartments error', err);
        return of([] as ApiDepartment[]);
      })
    ).subscribe(data => {
      this.departments.set(data);
      this.setLoading('department', false);
      this.loaded.add('department');
    });
  }

  retry(key: PanelKey) {
    this.loaded.delete(key);
    this.loadPanel(key, true);
  }

  // ===================== CREATE USER =====================

  openUserModal() {
    this.newUser = { userName: '', role: Role.Developer, password: '' };
    this.userFormError.set(null);
    this.showUserModal.set(true);
  }

  closeUserModal() {
    this.showUserModal.set(false);
  }

  submitNewUser() {
    if (!this.newUser.userName.trim() || !this.newUser.password.trim()) {
      this.userFormError.set('Username and password are required.');
      return;
    }

    this.userFormSubmitting.set(true);
    this.userFormError.set(null);

    const payload = {
      userName: this.newUser.userName.trim(),
      role: this.newUser.role,
      password: this.newUser.password,
    };

    this.http.post<ApiUser>(`${API_BASE}/Auth/register`, payload).pipe(
      catchError(err => {
        this.userFormError.set(err?.error?.message ?? 'Failed to create user.');
        console.error('createUser error', err);
        return of(null);
      })
    ).subscribe(result => {
      this.userFormSubmitting.set(false);
      if (result) {
        this.showUserModal.set(false);
        this.retry('users'); // refresh the users list
      }
    });
  }

  // ===================== CREATE DEPARTMENT =====================

  openDeptModal() {
    this.newDept = { departmentName: '', description: '' };
    this.deptFormError.set(null);
    this.showDeptModal.set(true);
  }

  closeDeptModal() {
    this.showDeptModal.set(false);
  }

  submitNewDepartment() {
    if (!this.newDept.departmentName.trim()) {
      this.deptFormError.set('Department name is required.');
      return;
    }

    this.deptFormSubmitting.set(true);
    this.deptFormError.set(null);

    const payload = {
      departmentName: this.newDept.departmentName.trim(),
      description: this.newDept.description.trim(),
    };

    this.http.post<ApiDepartment>(`${API_BASE}/Department`, payload).pipe(
      catchError(err => {
        this.deptFormError.set(err?.error?.message ?? 'Failed to create department.');
        console.error('createDepartment error', err);
        return of(null);
      })
    ).subscribe(result => {
      this.deptFormSubmitting.set(false);
      if (result) {
        this.showDeptModal.set(false);
        this.retry('department'); // refresh the department list
      }
    });
  }

  // ===================== DEPARTMENT MEMBERSHIP =====================

roleLabel(role: number): string {
    return this.roleOptions.find(r => r.value === role)?.label ?? `Unknown (${role})`;
  }
  // Users NOT currently in the active department
  availableUsers = computed(() => {
    const memberIds = new Set(this.deptMembers().map(m => m.id));
    return this.users().filter(u => !memberIds.has(u.id));
  });

  openMembersModal(dept: ApiDepartment) {
    this.activeDept.set(dept);
    this.memberActionError.set(null);
    this.showMembersModal.set(true);
    this.fetchDeptMembers(dept.id);
  }

  closeMembersModal() {
    this.showMembersModal.set(false);
    this.activeDept.set(null);
    this.deptMembers.set([]);
  }

  fetchDeptMembers(departmentId: string) {
    this.membersLoading.set(true);
    this.memberActionError.set(null);

    this.http.get<ApiUser[]>(`${API_BASE}/Department/${departmentId}/users`).pipe(
      catchError(err => {
        this.memberActionError.set('Failed to load department members.');
        console.error('fetchDeptMembers error', err);
        return of([] as ApiUser[]);
      })
    ).subscribe(data => {
      this.deptMembers.set(data);
      this.membersLoading.set(false);
    });
  }

  addUserToDepartment(userId: string) {
    const dept = this.activeDept();
    if (!dept) return;

    this.memberActionPendingId.set(userId);
    this.memberActionError.set(null);

    this.http.post(`${API_BASE}/Department/${dept.id}/users/${userId}`, {}).pipe(
      catchError(err => {
        this.memberActionError.set('Failed to add user to department.');
        console.error('addUserToDepartment error', err);
        return of(null);
      })
    ).subscribe(result => {
      this.memberActionPendingId.set(null);
      if (result !== null) {
        this.fetchDeptMembers(dept.id); // refresh member list in modal
        this.retry('department');       // refresh userCount in table
      }
    });
  }

  removeUserFromDepartment(userId: string) {
    const dept = this.activeDept();
    if (!dept) return;

    this.memberActionPendingId.set(userId);
    this.memberActionError.set(null);

    this.http.delete(`${API_BASE}/Department/${dept.id}/users/${userId}`).pipe(
      catchError(err => {
        this.memberActionError.set('Failed to remove user from department.');
        console.error('removeUserFromDepartment error', err);
        return of(null);
      })
    ).subscribe(result => {
      this.memberActionPendingId.set(null);
      if (result !== null) {
        this.fetchDeptMembers(dept.id); // refresh member list in modal
        this.retry('department');       // refresh userCount in table
      }
    });
  }



  // ===================== DELETE USER =====================

  deleteUserPendingId = signal<string | null>(null);
  deleteUserError = signal<string | null>(null);

  deleteUser(user: ApiUser) {
    const confirmed = confirm(`Delete user "${user.userName}"? This cannot be undone.`);
    if (!confirmed) return;

    this.deleteUserPendingId.set(user.id);
    this.deleteUserError.set(null);

    this.http.delete<{ message: string; id: string }>(`${API_BASE}/Auth/${user.id}`).pipe(
      catchError(err => {
        // Surfaces backend messages like "Admin users cannot be deleted."
        const message = err?.error?.message ?? 'Failed to delete user.';
        this.deleteUserError.set(message);
        console.error('deleteUser error', err);
        return of(null);
      })
    ).subscribe(result => {
      this.deleteUserPendingId.set(null);
      if (result) {
        this.retry('users'); // refresh the users list
      }
    });
  }
}
