import { Routes } from '@angular/router';
import { Packages } from './packages/packages';
import { Activity } from './activity/activity';
import { MyFlows } from './my-flows/my-flows';

export const routes: Routes = [

  { path: 'packages', component: Packages },
  { path: '', component: Packages },
  { path: 'history', component: Activity },
  { path: 'myflows', component: MyFlows },

{
  path: 'my-flows/:id',
  loadComponent: () => import('./flow-details/flow-details').then((m) => m.FlowDetails),
},


];
