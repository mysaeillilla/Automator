import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../navbar-component/navbar-component';

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface Schedule {
  id: string;

  // API fields
  scheduleName?: string;
  processId?: string;
  time?: string;
  nextRun?: string;
  isActive?: boolean;

  // Display fields
  processName?: string;
  departmentName?: string;
  scheduleType?: string;
  scheduledTime?: string;
  frequency: string;
  status?: string;
}

interface CreateScheduleRequest {
  scheduleName: string;
  processId: string;
  time: string;
  frequency: string;
  nextRun: string;
  isActive: boolean;
}

@Component({
  selector: 'app-schedules-component',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NavbarComponent
  ],
  templateUrl: './schedules-component.html',
  styleUrl: './schedules-component.css',
})
export class SchedulesComponent {

  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  private readonly apiUrl = '/api/Schedules';

  // =========================================================
  // Admin
  // =========================================================

  isAdmin = signal(
    localStorage.getItem('role')?.trim().toLowerCase() === 'admin'
  );

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
        break;
    }
  }

  // =========================================================
  // Schedules
  // =========================================================

  schedules = signal<Schedule[]>([]);

  loading = signal(false);
  error = signal<string | null>(null);

  creating = signal(false);
  deletingId = signal<string | null>(null);

  createError = signal<string | null>(null);
  createSuccess = signal<string | null>(null);

  // =========================================================
  // Create Schedule Form
  // =========================================================

  scheduleForm = this.fb.nonNullable.group({
    scheduleName: ['', Validators.required],

    processId: [
      '',
      [
        Validators.required,
        Validators.pattern(
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
        )
      ]
    ],

    time: ['', Validators.required],

    frequency: ['', Validators.required],

    nextRun: ['', Validators.required],

    isActive: [true]
  });

  // =========================================================
  // Lifecycle
  // =========================================================

  ngOnInit(): void {
    this.loadSchedules();
  }

  // =========================================================
  // GET /api/Schedules
  // =========================================================

  loadSchedules(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<Schedule[]>(this.apiUrl).subscribe({
      next: (data) => {
        this.schedules.set(data ?? []);
        this.loading.set(false);
      },

      error: (err) => {
        console.error('Failed to load schedules:', err);

        this.error.set(
          err?.error?.message ||
          'Failed to load schedules.'
        );

        this.loading.set(false);
      }
    });
  }

  // =========================================================
  // POST /api/Schedules
  // =========================================================

  createSchedule(): void {

    this.createError.set(null);
    this.createSuccess.set(null);

    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }

    this.creating.set(true);

    const formValue = this.scheduleForm.getRawValue();

    const request: CreateScheduleRequest = {
      scheduleName: formValue.scheduleName,
      processId: formValue.processId,
      time: formValue.time,
      frequency: formValue.frequency,

      // Convert datetime-local value to ISO 8601
      nextRun: new Date(formValue.nextRun).toISOString(),

      isActive: formValue.isActive
    };

    this.http.post<Schedule>(
      this.apiUrl,
      request
    ).subscribe({

      next: () => {
        this.creating.set(false);

        this.createSuccess.set(
          'Schedule created successfully.'
        );

        this.scheduleForm.reset({
          scheduleName: '',
          processId: '',
          time: '',
          frequency: '',
          nextRun: '',
          isActive: true
        });

        // Reload schedules so the new schedule appears
        this.loadSchedules();
      },

      error: (err) => {
        console.error('Failed to create schedule:', err);

        this.creating.set(false);

        this.createError.set(
          err?.error?.message ||
          'Failed to create schedule.'
        );
      }
    });
  }

  // =========================================================
  // DELETE /api/Schedules/{id}
  // =========================================================

  deleteSchedule(schedule: Schedule): void {

    if (!schedule.id) {
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to delete "${schedule.scheduleName || schedule.processName || 'this schedule'}"?`
    );

    if (!confirmed) {
      return;
    }

    this.deletingId.set(schedule.id);
    this.error.set(null);

    this.http.delete(
      `${this.apiUrl}/${schedule.id}`
    ).subscribe({

      next: () => {

        this.deletingId.set(null);

        // Remove immediately from UI
        this.schedules.update(
          schedules =>
            schedules.filter(item => item.id !== schedule.id)
        );
      },

      error: (err) => {
        console.error('Failed to delete schedule:', err);

        this.deletingId.set(null);

        this.error.set(
          err?.error?.message ||
          'Failed to delete schedule.'
        );
      }
    });
  }

  retry(): void {
    this.loadSchedules();
  }
}
