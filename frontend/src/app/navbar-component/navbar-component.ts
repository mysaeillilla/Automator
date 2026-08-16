import { Component, OnInit, signal } from '@angular/core';
import { AuthService } from '../auth-service';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navbar-component',
  imports: [RouterLink,CommonModule],
  templateUrl: './navbar-component.html',
  styleUrl: './navbar-component.css',
})
export class NavbarComponent implements OnInit {

 username = signal('');
  isLoggedIn = signal(false);
 role = signal('');

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}
  ngOnInit(): void {

    const storedUsername = localStorage.getItem('username');
    const storedRole = localStorage.getItem('role');
    console.log(storedRole);
    if (storedUsername) {
      this.username.set(storedUsername);
      this.isLoggedIn.set(true);
       this.role.set(storedRole || '');
    } else {
      this.username.set('');
      this.isLoggedIn.set(false);this.role.set('');
    }
  }


  logout(): void {

    this.authService.logout();

    this.username.set('');
    this.isLoggedIn.set(false);
this.role.set('');
    this.router.navigate(['/login']);
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
}
