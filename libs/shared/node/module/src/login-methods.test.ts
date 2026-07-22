import {
  aggregateLoginMethods,
  DuplicateLoginMethodError,
  NoLoginMethodError,
} from './login-methods.js';

describe('aggregateLoginMethods', () => {
  it('returns one registered login method', () => {
    const loginMethods = aggregateLoginMethods({
      modules: [{name: 'password', loginMethods: [{id: 'password'}]}],
    });

    expect(loginMethods).toEqual([{id: 'password'}]);
  });

  it('aggregates login methods in module order and skips modules without them', () => {
    const loginMethods = aggregateLoginMethods({
      modules: [
        {name: 'database'},
        {name: 'password', loginMethods: [{id: 'password'}]},
        {name: 'sso', loginMethods: [{id: 'acme-sso'}]},
      ],
    });

    expect(loginMethods).toEqual([{id: 'password'}, {id: 'acme-sso'}]);
  });

  it('rejects duplicate login methods from different modules', () => {
    const result = () =>
      aggregateLoginMethods({
        modules: [
          {name: 'password', loginMethods: [{id: 'password'}]},
          {name: 'backup-password', loginMethods: [{id: 'password'}]},
        ],
      });

    expect(result).toThrow(DuplicateLoginMethodError);
    expect(result).toThrow('password');
    try {
      result();
    } catch (error) {
      expect(error).toMatchObject({
        loginMethodId: 'password',
        firstModule: 'password',
        secondModule: 'backup-password',
      });
    }
  });

  it('rejects a module that repeats its own login method', () => {
    const result = () =>
      aggregateLoginMethods({
        modules: [{name: 'password', loginMethods: [{id: 'password'}, {id: 'password'}]}],
      });

    expect(result).toThrow(DuplicateLoginMethodError);
  });

  it('rejects a composition with no login methods', () => {
    const result = () => aggregateLoginMethods({modules: [{name: 'database'}]});

    expect(result).toThrow(NoLoginMethodError);
    expect(result).toThrow('Contribute a login method');
  });

  it('does not treat request authentication as a login method', () => {
    const result = () =>
      aggregateLoginMethods({
        modules: [
          {
            name: 'request-auth',
            auth: [
              {
                name: 'jwt',
                authenticate: async () => undefined,
              },
            ],
          },
        ],
      });

    expect(result).toThrow(NoLoginMethodError);
  });

  it('preserves unknown future login method IDs', () => {
    const loginMethods = aggregateLoginMethods({
      modules: [{name: 'future-provider', loginMethods: [{id: 'future-provider'}]}],
    });

    expect(loginMethods).toEqual([{id: 'future-provider'}]);
  });
});
