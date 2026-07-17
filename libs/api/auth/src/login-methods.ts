import type {LoginMethod} from '@shipfox/node-module';

export function passwordLoginMethods(passwordEnabled: boolean): LoginMethod[] {
  return passwordEnabled ? [{id: 'password'}] : [];
}
