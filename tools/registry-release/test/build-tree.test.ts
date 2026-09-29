import {type Lockfile, productionDependencies, trimWorkspace} from '../src/build-tree.js';

const LOCKFILE: Lockfile = {
  lockfileVersion: '9.0',
  catalogs: {
    default: {
      react: {specifier: '^19.1.1', version: '19.1.1'},
      vitest: {specifier: '^4.1.5', version: '4.1.5'},
    },
    legacy: {typescript: {specifier: '^6.0.3', version: '6.0.3'}},
    unused: {left: {specifier: '^1.0.0', version: '1.0.0'}},
  },
  importers: {
    '.': {devDependencies: {vitest: {specifier: 'catalog:', version: '4.1.5'}}},
    'libs/action': {
      dependencies: {
        'react-dom': {specifier: '^19.1.1', version: '19.1.1(react@19.1.1)'},
        '@fixture/lib': {specifier: 'workspace:*', version: 'link:../lib'},
      },
      devDependencies: {typescript: {specifier: 'catalog:legacy', version: '6.0.3'}},
    },
    'libs/lib': {dependencies: {react: {specifier: 'catalog:', version: '19.1.1'}}},
  },
  packages: {
    'react@19.1.1': {},
    'react-dom@19.1.1': {},
    'scheduler@0.26.0': {},
    'typescript@6.0.3': {},
    'vitest@4.1.5': {},
  },
  snapshots: {
    'react@19.1.1': {},
    'react-dom@19.1.1(react@19.1.1)': {
      dependencies: {react: '19.1.1', scheduler: '0.26.0'},
    },
    'scheduler@0.26.0': {},
    'typescript@6.0.3': {},
    'vitest@4.1.5': {},
  },
};

describe('trimWorkspace', () => {
  const trimmed = trimWorkspace({
    workspace: {
      packages: ['libs/**'],
      catalog: {react: '^19.1.1', vitest: '^4.1.5', '@types/pg': '^8.15.6'},
      catalogs: {legacy: {typescript: '^6.0.3'}, unused: {left: '^1.0.0'}},
      overrides: {'@types/pg': 'catalog:'},
      minimumReleaseAge: 2880,
    },
    lockfile: LOCKFILE,
  });

  it('keeps the catalog entries the importers or overrides use, and the other settings', () => {
    expect(trimmed.workspace).toEqual({
      packages: ['libs/**'],
      catalog: {react: '^19.1.1', '@types/pg': '^8.15.6'},
      catalogs: {legacy: {typescript: '^6.0.3'}},
      overrides: {'@types/pg': 'catalog:'},
      minimumReleaseAge: 2880,
    });
    expect(trimmed.lockfile.catalogs).toEqual({
      default: {react: {specifier: '^19.1.1', version: '19.1.1'}},
      legacy: {typescript: {specifier: '^6.0.3', version: '6.0.3'}},
    });
  });

  it('empties the root importer and keeps the devDependencies of the others', () => {
    expect(trimmed.lockfile.importers['.']).toEqual({});
    expect(trimmed.lockfile.importers['libs/action']).toEqual(LOCKFILE.importers['libs/action']);
  });

  it('keeps only the packages production dependencies reach, through peer contexts', () => {
    expect(Object.keys(trimmed.lockfile.packages ?? {})).toEqual([
      'react@19.1.1',
      'react-dom@19.1.1',
      'scheduler@0.26.0',
    ]);
    expect(Object.keys(trimmed.lockfile.snapshots ?? {})).toEqual([
      'react@19.1.1',
      'react-dom@19.1.1(react@19.1.1)',
      'scheduler@0.26.0',
    ]);
    expect(Object.keys(trimmed.lockfile)).toEqual(Object.keys(LOCKFILE));
  });

  it('lists the kept packages as resolved dependencies', () => {
    expect(
      productionDependencies({
        importers: {},
        packages: {'@types/pg@8.15.6': {}, 'react@19.1.1': {}, 'pg@8.16.3': {}},
      }),
    ).toEqual([
      {name: '@types/pg', version: '8.15.6'},
      {name: 'pg', version: '8.16.3'},
      {name: 'react', version: '19.1.1'},
    ]);
  });
});
