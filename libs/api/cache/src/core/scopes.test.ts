import {ReservedScopeError} from './errors.js';
import {assertScopeNotReserved, createScopeView, parseDevSandbox} from './scopes.js';

describe('createScopeView', () => {
  it('reads and writes a synced run in the scope the author wrote', () => {
    const view = createScopeView({origin: 'synced', initiatedByUserId: null});

    expect(view.readScopes('main')).toEqual(['main']);
    expect(view.writeScope('main')).toBe('main');
  });

  it('gives a dev run a sandbox per user that it reads before the shared scope', () => {
    const view = createScopeView({origin: 'dev', initiatedByUserId: 'user-1'});

    expect(view.readScopes('main')).toEqual(['dev/user-1/main', 'main']);
    expect(view.writeScope('main')).toBe('dev/user-1/main');
  });

  it('gives a dev run without a user the shared sandbox', () => {
    const view = createScopeView({origin: 'dev', initiatedByUserId: null});

    expect(view.readScopes('main')).toEqual(['dev/shared/main', 'main']);
    expect(view.writeScope('main')).toBe('dev/shared/main');
  });
});

describe('assertScopeNotReserved', () => {
  it.each(['dev', 'dev/', 'dev/user-1/main'])('rejects %s', (scope) => {
    expect(() => assertScopeNotReserved(scope)).toThrow(ReservedScopeError);
  });

  it.each(['default', 'devtools', 'dev-1', 'main/dev/x'])('accepts %s', (scope) => {
    expect(() => assertScopeNotReserved(scope)).not.toThrow();
  });
});

describe('parseDevSandbox', () => {
  it('reads the owner and the authored scope of a sandbox', () => {
    expect(parseDevSandbox('dev/user-1/main')).toEqual({userId: 'user-1', scope: 'main'});
    expect(parseDevSandbox('dev/user-1/pr/12')).toEqual({userId: 'user-1', scope: 'pr/12'});
  });

  it('reads the shared sandbox as a sandbox without a user', () => {
    expect(parseDevSandbox('dev/shared/main')).toEqual({userId: null, scope: 'main'});
  });

  it.each([
    'default',
    'devtools/x/y',
    'main/dev/x/y',
    'dev',
    'dev/user-1',
  ])('reads %s as no sandbox', (scope) => {
    expect(parseDevSandbox(scope)).toBeNull();
  });
});
