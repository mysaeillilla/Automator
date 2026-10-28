import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Service } from '@angular/core';
import { environment } from '../environments/environment.development';
import { PackageResponse } from './package/package-module';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PackageService {
  private readonly http = inject(HttpClient);

  // apiUrl already ends with '/', so no extra slash here
  private readonly baseUrl = `${environment.apiUrl}/api/Packages`;

  getAll(): Observable<PackageResponse[]> {

    console.log(this.baseUrl);
    return this.http.get<PackageResponse[]>(this.baseUrl);
  }

  upload(file: File): Observable<unknown> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // Don't set Content-Type yourself: the browser adds the multipart boundary
    return this.http.post(`${this.baseUrl}/upload`, formData);
  }
}
