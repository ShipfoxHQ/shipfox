import {atom} from 'jotai';

export {
  type AuthState,
  type AuthStatus,
  authStateAtom,
  initialAuthState,
  toAuthenticatedState,
  useAuthTransition,
  type Workspace,
} from '@shipfox/client-shell/runtime';

export interface AuthFormDraft {
  email: string;
  password: string;
}

export const initialAuthFormDraft: AuthFormDraft = {email: '', password: ''};
export const authFormDraftAtom = atom<AuthFormDraft>(initialAuthFormDraft);
