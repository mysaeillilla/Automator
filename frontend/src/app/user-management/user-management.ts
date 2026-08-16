import { Component, OnInit, signal } from '@angular/core';
import { CreateUserRequest, User, UserService } from '../user-service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './user-management.html',
  styleUrl: './user-management.css',
})
export class UserManagement implements OnInit {

  users = signal<User[]>([]);

  showCreateModal = signal(false);

  loading = signal(false);

  creating = signal(false);

  errorMessage = signal('');

  successMessage = signal('');

  newUser: CreateUserRequest = {
    userName: '',
    password: '',
    role: 'Developer'
  };

  roles = [
    'Admin',
    'Developer',
    'Creator'
  ];

  constructor(
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  getInitials(name: string): string {

    if (!name) {
      return 'U';
    }

    const parts = name.trim().split(' ');

    if (parts.length === 1) {
      return parts[0]
        .substring(0, 2)
        .toUpperCase();
    }

    return (
      parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  }

  loadUsers(): void {

    this.loading.set(true);

    this.errorMessage.set('');

    this.userService.getUsers()
      .subscribe({

        next: (users) => {
          this.users.set(users);
          this.loading.set(false);
        },

        error: (error) => {
          console.error(
            'Failed to load users',
            error
          );

          this.errorMessage.set('Failed to load users.');

          this.loading.set(false);
        }

      });
  }

  openCreateUser(): void {
    this.resetForm();
    this.showCreateModal.set(true);
  }

  closeCreateUser(): void {

    if (this.creating()) {
      return;
    }

    this.showCreateModal.set(false);
  }

  resetForm(): void {

    this.newUser = {
      userName: '',
      password: '',
      role: 'Developer'
    };

    this.errorMessage.set('');
  }

  createUser(): void {

    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.newUser.userName.trim()) {
      this.errorMessage.set('Username is required.');
      return;
    }

    if (!this.newUser.password.trim()) {
      this.errorMessage.set('Password is required.');
      return;
    }

    this.creating.set(true);

    this.userService
      .createUser(this.newUser)
      .subscribe({

        next: (user) => {

          this.users.update(users => [...users, user]);

          this.creating.set(false);

          this.showCreateModal.set(false);

          this.successMessage.set(
            `User "${user.userName}" created successfully.`
          );

        },

        error: (error) => {

          console.error(
            'Failed to create user',
            error
          );

          this.creating.set(false);

          if (error.status === 409) {

            this.errorMessage.set(
              error.error?.message ||
              'Username already exists.'
            );

          }
          else {

            this.errorMessage.set('Failed to create user.');

          }

        }

      });

  }
}
