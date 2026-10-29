import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type NavId = 'create' | 'my-flows' | 'packages' | 'history' | 'settings';

interface NavItem {
  id: NavId;
  label: string;
  route: string;
}

@Component({
  imports: [RouterLink, RouterLinkActive],
  selector: 'app-side-bar',
  styleUrl: './side-bar.css',
  templateUrl: './side-bar.html',
})
export class SideBar {
  readonly collapsed = signal(false);

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Apply the correct state when the sidebar is first loaded.
    this.updateSidebarState(this.router.url);

    // Update the sidebar whenever navigation completes.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        this.updateSidebarState(event.urlAfterRedirects);
      });
  }

  readonly mainItems: NavItem[] = [
    { id: 'create', label: 'Create', route: '/createflow' },
    { id: 'my-flows', label: 'My Flows', route: '/myflows' },
    { id: 'packages', label: 'Packages', route: '/packages' },
    { id: 'history', label: 'History', route: '/history' },
  ];

  readonly settingsItem: NavItem = {
    id: 'settings',
    label: 'Settings',
    route: '/settings',
  };

  toggle(): void {
    this.collapsed.update((value) => !value);
  }

  private updateSidebarState(url: string): void {
    const isCreateFlowRoute =
      url === '/createflow' || url.startsWith('/createflow/');

    this.collapsed.set(isCreateFlowRoute);
  }
}
