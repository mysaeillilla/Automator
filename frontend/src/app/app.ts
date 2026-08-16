import { Component, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Login } from "./login/login";
import { NavbarComponent } from "./navbar-component/navbar-component";

@Component({
  selector: 'app-root',
  imports: [Login, RouterOutlet, RouterLink, NavbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('frontend');
}
