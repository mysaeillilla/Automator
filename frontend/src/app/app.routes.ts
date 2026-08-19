import { Routes } from '@angular/router';
import { HomeComponent } from './home-component/home-component';
import { Login } from './login/login';
import { UserManagement } from './user-management/user-management';
import { AdminPanel } from './admin-panel/admin-panel';
import { DepartmentsComponent } from './departments-component/departments-component';
import { ProcessDetailsComponent } from './process-details-component/process-details-component';
import { AuditlogComponent } from './auditlog-component/auditlog-component';
import { Departments } from './departments/departments';
import { SchedulesComponent } from './schedules-component/schedules-component';

export const routes: Routes = [

  {path:'',
    component:HomeComponent
  },

  {path:'login',
    component:Login
  },
  {path:'users',
    component:UserManagement
  },
  {path:'control-panel',
    component:AdminPanel
  },
{ path: 'admin', component: AdminPanel },
  { path: 'departments/:id', component: DepartmentsComponent },
  { path: 'process/process-list', component: ProcessDetailsComponent },
  { path: 'history', component: AuditlogComponent },
  { path: 'departments', component: Departments },
  { path: 'schedules', component: SchedulesComponent },





];
