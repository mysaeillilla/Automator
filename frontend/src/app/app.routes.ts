import { Routes } from '@angular/router';
import { HomeComponent } from './home-component/home-component';
import { Login } from './login/login';
import { UserManagement } from './user-management/user-management';
import { AdminPanel } from './admin-panel/admin-panel';

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
  {path:'admin-panel',
    component:AdminPanel
  },



];
