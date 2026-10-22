import { Routes } from '@angular/router';
import { Packages } from './packages/packages';
import { Activity } from './activity/activity';

export const routes: Routes = [

  { path: 'packages', component: Packages },
  { path: '', component: Packages },
  { path: 'history', component: Activity },




];
