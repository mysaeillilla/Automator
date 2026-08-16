import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth-service';
import { NavbarComponent } from "../navbar-component/navbar-component";

@Component({
  selector: 'app-home-component',
  imports: [CommonModule, RouterLink, NavbarComponent],
  templateUrl: './home-component.html',
  styleUrl: './home-component.css',
})
export class HomeComponent {
 username=signal('');

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.username.set(localStorage.getItem('username') || 'User');
  }

  logout(): void {
    this.authService.logout();

    this.router.navigate(['/login']);
  }

  getInitials(name: string): string {

  if (!name) {
    return 'U';
  }

  const parts = name.trim().split(' ');

  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }

  return (
    parts[0].charAt(0) +
    parts[parts.length - 1].charAt(0)
  ).toUpperCase();
}


   stats = [
    {
      title: 'Total Workflows',
      value: '24',
      icon: '🔄',
      route: '/workflow'
    },
    {
      title: 'Running Bots',
      value: '8',
      icon: '▶',
      route: '/jobs'
    },
    {
      title: 'Completed',
      value: '156',
      icon: '✓',
      route: '/jobs'
    },
    {
      title: 'Failed',
      value: '12',
      icon: '⚠',
      route: '/jobs'
    }
  ];

  quickActions = [
    {
      title: 'Create Workflow',
      description: 'Build a new automation workflow',
      icon: '＋',
      route: '/workflow'
    },
    {
      title: 'Run Bot',
      description: 'Execute an existing automation',
      icon: '▶',
      route: '/jobs'
    },
    {
      title: 'Upload File',
      description: 'Upload files for processing',
      icon: '↑',
      route: '/upload'
    },
    {
      title: 'View Jobs',
      description: 'Check automation execution status',
      icon: '☷',
      route: '/jobs'
    }
  ];

  recentActivities = [
    {
      name: 'Invoice Processing',
      status: 'Completed',
      time: '10 minutes ago'
    },
    {
      name: 'Excel Data Extraction',
      status: 'Running',
      time: '25 minutes ago'
    },
    {
      name: 'Email Automation',
      status: 'Failed',
      time: '1 hour ago'
    },
    {
      name: 'Report Generation',
      status: 'Completed',
      time: '2 hours ago'
    }
  ];
}
