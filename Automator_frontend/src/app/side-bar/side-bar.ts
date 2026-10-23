import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

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

  readonly mainItems: NavItem[] = [
    { id: 'create', label: 'Create', route: '/create' },
    { id: 'my-flows', label: 'My Flows', route: '/myflows' },
    { id: 'packages', label: 'Packages', route: '/packages' },
    { id: 'history', label: 'History', route: '/history' },
  ];

  readonly settingsItem: NavItem = { id: 'settings', label: 'Settings', route: '/settings' };

  toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
