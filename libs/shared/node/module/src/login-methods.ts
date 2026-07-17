import type {LoginMethod, ShipfoxModule} from './types.js';

export class NoLoginMethodError extends Error {
  constructor() {
    super(
      'No login methods are configured. Contribute a login method from a module before starting the server.',
    );
    this.name = 'NoLoginMethodError';
  }
}

export class DuplicateLoginMethodError extends Error {
  public readonly loginMethodId: string;
  public readonly firstModule: string;
  public readonly secondModule: string;

  constructor({
    loginMethodId,
    firstModule,
    secondModule,
  }: {
    loginMethodId: string;
    firstModule: string;
    secondModule: string;
  }) {
    super(
      `Duplicate login method "${loginMethodId}" contributed by modules "${firstModule}" and "${secondModule}". Each login method identifier must have one owning module.`,
    );
    this.name = 'DuplicateLoginMethodError';
    this.loginMethodId = loginMethodId;
    this.firstModule = firstModule;
    this.secondModule = secondModule;
  }
}

export function aggregateLoginMethods({
  modules,
}: {
  modules: readonly ShipfoxModule[];
}): LoginMethod[] {
  const loginMethods: LoginMethod[] = [];
  const moduleNamesByLoginMethodId = new Map<string, string>();

  for (const module of modules) {
    for (const loginMethod of module.loginMethods ?? []) {
      const firstModule = moduleNamesByLoginMethodId.get(loginMethod.id);
      if (firstModule !== undefined) {
        throw new DuplicateLoginMethodError({
          loginMethodId: loginMethod.id,
          firstModule,
          secondModule: module.name,
        });
      }
      moduleNamesByLoginMethodId.set(loginMethod.id, module.name);
      loginMethods.push(loginMethod);
    }
  }

  if (loginMethods.length === 0) throw new NoLoginMethodError();
  return loginMethods;
}
