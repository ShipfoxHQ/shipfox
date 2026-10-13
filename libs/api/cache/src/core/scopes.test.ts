import {ReservedScopeError} from './errors.js';
import {assertScopeNotReserved, createScopeView} from './scopes.js';

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
