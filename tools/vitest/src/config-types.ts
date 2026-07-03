import type {UserWorkspaceConfig, defineConfig as vitestDefineConfig} from 'vitest/config';

type VitestUserConfig = Parameters<typeof vitestDefineConfig>[0];

export type ConfigInput = VitestUserConfig | UserWorkspaceConfig;

export type ResolveAlias =
  | Array<{find: string | RegExp; replacement: string}>
  | Record<string, string>;

export type MergeableConfigInput = ConfigInput & {
  plugins?: unknown[];
  resolve?: {
    alias?: ResolveAlias;
    conditions?: string[];
    externalConditions?: string[];
    external?: string[] | true;
  };
  ssr?: {
    external?: string[] | true;
    resolve?: {
      conditions?: string[];
      externalConditions?: string[];
    };
  };
  optimizeDeps?: {
    rolldownOptions?: {
      checks?: Record<string, unknown>;
    };
  };
  test?: {
    deps?: {
      optimizer?: Record<
        string,
        {
          enabled?: boolean;
          include?: string[];
        }
      >;
    };
    exclude?: string[];
    server?: {
      deps?: {
        external?: (string | RegExp)[];
        inline?: (string | RegExp)[] | true;
        fallbackCJS?: boolean;
      };
      debug?: unknown;
    };
  };
};

export type EnvironmentConfig = {
  resolve?: {
    alias?: ResolveAlias;
    conditions?: string[];
    externalConditions?: string[];
    external?: string[] | true;
  };
};

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
