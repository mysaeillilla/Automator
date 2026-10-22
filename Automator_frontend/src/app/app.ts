import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './header/header';
import { SideBar } from './side-bar/side-bar';
import { Packages } from './packages/packages';

@Component({
  imports: [RouterOutlet, Header, SideBar, Packages],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('Automator_frontend');
}
