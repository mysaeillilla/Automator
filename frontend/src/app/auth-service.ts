import { HttpClient } from '@angular/common/http';
import { Injectable, Service } from '@angular/core';
import { Observable, tap } from 'rxjs';


export interface LoginRequest {
  userName: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  userName: string;
  expiresAt: string;
  role: string;
}



@Injectable({ providedIn: 'root' })
export class AuthService {

private readonly apiUrl = 'https://localhost:5002/api/auth'; // adjust to your API base URL
  private readonly tokenKey = 'auth_token';
  private readonly role = 'role';

  constructor(private http: HttpClient) {}

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, request).pipe(
      tap((res) => this.setSession(res))
    );
  }

  private setSession(res: AuthResponse): void {

    console.log(res);
    localStorage.setItem(this.tokenKey, res.token);
    localStorage.setItem('username', res.userName);
    localStorage.setItem('expires_at', res.expiresAt);
    localStorage.setItem('role', res.role);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

   getRole(): string | null {
    return localStorage.getItem(this.role);
  }

  isLoggedIn(): boolean {
    const expiresAt = localStorage.getItem('expires_at');
    if (!this.getToken() || !expiresAt) return false;
    return new Date(expiresAt) > new Date();
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem('username');
    localStorage.removeItem('expires_at');
  }

}
