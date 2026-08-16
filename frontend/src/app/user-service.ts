import { HttpClient } from '@angular/common/http';
import { Injectable, Service } from '@angular/core';
import { Observable } from 'rxjs';
export interface User {
  id: string;
  userName: string;
  role: string;
  createdAt: string;
  lastActive: string;
}

export interface CreateUserRequest {
  userName: string;
  password: string;
  role: string;
}


@Injectable({
  providedIn: 'root'
})
export class UserService {

 private readonly apiUrl =
    'https://localhost:5002/api/Auth';

  constructor(
    private http: HttpClient
  ) {}


  getUsers(): Observable<User[]> {

    return this.http.get<User[]>(
      this.apiUrl
    );
  }


  createUser(
    request: CreateUserRequest
  ): Observable<User> {

    return this.http.post<User>(
      `${this.apiUrl}/users`,
      request
    );
  }

}
