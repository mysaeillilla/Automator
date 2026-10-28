import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment.development';
import { PagedResponse, WorkflowExecutionDetail, WorkflowExecutionQuery, WorkflowExecutionSummary } from './workflow-execution/workflow-execution-module';


@Injectable({ providedIn: 'root' })
export class WorkflowExecutionHistoryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/WorkflowExecutionHistory`;

  getHistory(query: WorkflowExecutionQuery): Observable<PagedResponse<WorkflowExecutionSummary>> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);

    if (query.status !== null && query.status !== undefined) {
      params = params.set('status', query.status);
    }
    if (query.fromUtc) {
      params = params.set('fromUtc', query.fromUtc.toISOString());
    }
    if (query.toUtc) {
      params = params.set('toUtc', query.toUtc.toISOString());
    }

    return this.http.get<PagedResponse<WorkflowExecutionSummary>>(this.baseUrl, { params });
  }

   getById(id: string): Observable<WorkflowExecutionDetail> {
    return this.http.get<WorkflowExecutionDetail>(`${this.baseUrl}/${id}`);
  }
}
