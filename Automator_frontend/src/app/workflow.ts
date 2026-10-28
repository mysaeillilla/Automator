import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { environment } from '../environments/environment.development';
import { Observable } from 'rxjs';
export interface WorkflowResponse {
  id: number;
  name: string;
  version: string;
  createdAt: string;
  createdBy: string;
}

export interface WorkflowDetailResponse extends WorkflowResponse {
  // Free-form JSON written by the user (flow_name, packages, variables, Actions...)
  workflow: Record<string, unknown>;
}


@Service()
export class Workflow {

  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/Workflows`;

  getAll(name: string, latestOnly: boolean): Observable<WorkflowResponse[]> {
    let params = new HttpParams().set('latestOnly', latestOnly);

    // Only send the name filter when there is something to search for
    if (name) {
      params = params.set('name', name);
    }

    return this.http.get<WorkflowResponse[]>(this.baseUrl, { params });
  }

  getById(id: string | number): Observable<WorkflowDetailResponse> {
    return this.http.get<WorkflowDetailResponse>(`${this.baseUrl}/${id}`);

  }
}
