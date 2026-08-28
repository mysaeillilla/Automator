import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NavbarComponent } from '../navbar-component/navbar-component';
import { PanelKey, Sidebar } from "../sidebar/sidebar";

interface ProcessDepartment {
  id: string;
  departmentName: string;
}

interface Process {
  id: string;
  processName: string;
  description?: string;
  processPath?: string;
  departmentId?: string;
  department?: ProcessDepartment;
  createdAt?: string;
  modifiedAt?: string;
  usersCount?: number;
}

interface ProcessListResponse {
  count: number;
  processes: Process[];
}

// Allowed frequency values accepted by the backend (case-insensitive there,
// but we keep them canonical here so the select and validation match exactly).
type Frequency = 'Once' | 'Daily' | 'Weekly' | 'Monthly';

const FREQUENCY_OPTIONS: Frequency[] = ['Once', 'Daily', 'Weekly', 'Monthly'];

// Shape returned by GET /api/Schedules and GET /api/Schedules/{id}
interface ApiSchedule {
  id: string;
  scheduleName: string;
  processId: string;
  processName: string;
  departmentId: string;
  departmentName: string;
  time: string;       // "HH:mm"
  frequency: string;
  nextRun: string;     // ISO datetime string
  isActive: boolean;
  createdAt: string;
  modifiedAt: string;
}

// Shape used for rendering in the template (raw API fields + derived display fields)
interface Schedule extends ApiSchedule {
  scheduleType: string;
  scheduledTime: string;
  status: string;
}

interface CreateScheduleRequest {
  scheduleName: string;
  processId: string;
  time: string;         // "HH:mm"
  frequency: Frequency;
  nextRun: string;       // "dd-MM-yyyy hh:mm tt", e.g. "23-08-2026 05:48 AM"
  isActive: boolean;
}

@Component({
  selector: 'app-schedules-component',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NavbarComponent,
    Sidebar
],
  templateUrl: './schedules-component.html',
  styleUrl: './schedules-component.css',
})
export class SchedulesComponent implements OnInit {

  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  private readonly apiUrl = 'https://localhost:5002/api/Schedules';
  private readonly processesUrl = 'https://localhost:5002/api/Process/all';

  // Exposed to the template for the frequency <select>
  readonly frequencyOptions = FREQUENCY_OPTIONS;

  // =========================================================
  // Admin
  // =========================================================

  isAdmin = signal(
    localStorage.getItem('role')?.trim().toLowerCase() === 'admin'
  );

  // =========================================================
  // Navigation (delegated to <app-sidebar>)
  // =========================================================

  selected = signal<PanelKey>('schedules');

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
  // Processes (for Process dropdown)
  // =========================================================

  processes = signal<Process[]>([]);
  processesLoading = signal(false);
  processesError = signal<string | null>(null);

  // =========================================================
  // Create Schedule Form
  // =========================================================

  // Time must be "HH:mm" (24-hour) to match the backend's TimeSpan.TryParseExact.
  private static readonly TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

  scheduleForm = this.fb.nonNullable.group({
    scheduleName: ['', Validators.required],

    processId: ['', Validators.required],

    time: ['', [Validators.required, Validators.pattern(SchedulesComponent.TIME_PATTERN)]],

    // Constrained to exactly what the backend accepts, so the <select>
    // in the template should bind to frequencyOptions.
    frequency: ['' as Frequency | '', Validators.required],

    nextRun: ['', Validators.required],

    isActive: [true]
  });

  // =========================================================
  // Lifecycle
  // =========================================================

  ngOnInit(): void {
    this.loadSchedules();
    this.loadProcesses();
  }

  // =========================================================
  // GET /api/Process/all
  // =========================================================

  loadProcesses(): void {
    this.processesLoading.set(true);
    this.processesError.set(null);

    this.http.get<ProcessListResponse>(this.processesUrl).subscribe({
      next: (data) => {
        this.processes.set(data?.processes ?? []);
        this.processesLoading.set(false);
      },

      error: (err) => {
        console.error('Failed to load processes:', err);

        this.processesError.set(
          err?.error?.message ||
          'Failed to load processes.'
        );

        this.processesLoading.set(false);
      }
    });
  }

  // =========================================================
  // GET /api/Schedules
  // =========================================================

  loadSchedules(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<ApiSchedule[]>(this.apiUrl).subscribe({
      next: (data) => {
        this.schedules.set((data ?? []).map(s => this.toDisplaySchedule(s)));
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

  // Map the raw API shape onto the display-friendly Schedule used by the template.
  private toDisplaySchedule(s: ApiSchedule): Schedule {
    return {
      ...s,
      scheduleType: s.frequency,
      scheduledTime: this.formatDisplayDateTime(s.nextRun, s.time),
      status: s.isActive ? 'Active' : 'Inactive'
    };
  }

  // Formats the ISO nextRun date for display; falls back to just the time if
  // nextRun can't be parsed.
  private formatDisplayDateTime(nextRunIso: string, time: string): string {
    const date = new Date(nextRunIso);

    if (isNaN(date.getTime())) {
      return time;
    }

    return date.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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

    const formValue = this.scheduleForm.getRawValue();

    const nextRunDate = new Date(formValue.nextRun);

    if (isNaN(nextRunDate.getTime())) {
      this.createError.set('Please enter a valid date and time for Next Run.');
      return;
    }

    if (!formValue.frequency) {
      this.createError.set('Please select a frequency.');
      return;
    }

    this.creating.set(true);

    const request: CreateScheduleRequest = {
      scheduleName: formValue.scheduleName,
      processId: formValue.processId,
      time: formValue.time,
      frequency: formValue.frequency,

      // Convert datetime-local value to "dd-MM-yyyy hh:mm tt"
      nextRun: this.formatNextRun(nextRunDate),

      isActive: formValue.isActive
    };

    this.http.post<ApiSchedule>(
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
        console.log(request);
        this.creating.set(false);

        this.createError.set(
          err?.error?.message ||
          'Failed to create schedule.'
        );
      }
    });
  }

  // =========================================================
  // Format a Date as "dd-MM-yyyy hh:mm tt" (e.g. "23-08-2026 05:48 AM")
  // =========================================================

  private formatNextRun(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');

    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = pad(date.getMinutes());

    const period = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    if (hours === 0) {
      hours = 12;
    }

    const hoursStr = pad(hours);

    return `${day}-${month}-${year} ${hoursStr}:${minutes} ${period}`;
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
    this.loadProcesses();
  }
}
