import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

@NgModule({
  declarations: [],
  imports: [CommonModule],
})
export class WorkflowExecutionModule {


}
export interface PagedResponse<T> {
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  data: T[];
}

export interface WorkflowExecutionSummary {
  id: string;
  status: number;
  totalActions: number;
  completedActions: number;
  failedActionId: string | number | null;
  error: string | null;
  startedAtUtc: string;
  completedAtUtc: string | null;
  durationMs: number | null;
}

export interface WorkflowExecutionQuery {
  status?: number | null;
  fromUtc?: Date | null;
  toUtc?: Date | null;
  page: number;
  pageSize: number;
}

// Swagger only shows 0-4. These labels are a guess: change them to match your C# enum.
export const STATUS_META: Record<number, { label: string; cssClass: string }> = {
  0: { label: 'Pending', cssClass: 'pending' },
  1: { label: 'Running', cssClass: 'running' },
  2: { label: 'Completed', cssClass: 'completed' },
  3: { label: 'Failed', cssClass: 'failed' },
  4: { label: 'Cancelled', cssClass: 'cancelled' },
};

export interface WorkflowActionExecution {
  id: string;
  sequence: number;
  actionId: string;
  className: string;
  functionName: string;
  status: number;
  inputsJson: string | null;
  outputsJson: string | null;
  error: string | null;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  durationMs: number | null;
}

export interface WorkflowExecutionDetail extends WorkflowExecutionSummary {
  workflowJson: string;
  inputsJson: string | null;
  outputsJson: string | null;
  logsJson: string | null;
  actions: WorkflowActionExecution[];
}

export function getStatusMeta(status: number): { label: string; cssClass: string } {
  return STATUS_META[status] ?? { label: `Unknown (${status})`, cssClass: 'pending' };
}
