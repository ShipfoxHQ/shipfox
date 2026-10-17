import {processState} from '@shipfox/node-process-state';
import {reportDuplicatePackageCopies} from './package-copies.js';

const mocks = vi.hoisted(() => ({logger: {warn: vi.fn()}}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => mocks.logger}));

const registerCopy = (params: {variant: string; key: string}) =>
  processState(
    params.key,
    () => ({}),
    `file:///app/node_modules/.pnpm/@shipfox+pkg@1.0.0_${params.variant}/node_modules/@shipfox/pkg/dist/state.js`,
  );

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of ['@shipfox/node-process-state/registry/v1', 'test/pkg/v1', 'test/pkg/v2']) {
    delete store[Symbol.for(key)];
  }
}

describe('reportDuplicatePackageCopies', () => {
  beforeEach(() => {
    clearSharedState();
    mocks.logger.warn.mockReset();
  });

  afterAll(clearSharedState);

  it('stays quiet with a single copy', () => {
    registerCopy({variant: 'x', key: 'test/pkg/v1'});

    reportDuplicatePackageCopies({strict: true});

    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('warns once per duplicated package and does not throw in strict mode when copies share state', () => {
    registerCopy({variant: 'x', key: 'test/pkg/v1'});
    registerCopy({variant: 'y', key: 'test/pkg/v1'});

    reportDuplicatePackageCopies({strict: true});

    expect(mocks.logger.warn).toHaveBeenCalledOnce();
    expect(mocks.logger.warn.mock.calls[0]?.[0]).toMatchObject({
      package: '@shipfox/pkg',
      sharesState: true,
      installFolders: [
        '/app/node_modules/.pnpm/@shipfox+pkg@1.0.0_x/node_modules/@shipfox/pkg',
        '/app/node_modules/.pnpm/@shipfox+pkg@1.0.0_y/node_modules/@shipfox/pkg',
      ],
    });
  });

  it('warns without throwing when copies do not share state and strict mode is off', () => {
    registerCopy({variant: 'x', key: 'test/pkg/v1'});
    registerCopy({variant: 'y', key: 'test/pkg/v2'});

    reportDuplicatePackageCopies({strict: false});

    expect(mocks.logger.warn).toHaveBeenCalledOnce();
    expect(mocks.logger.warn.mock.calls[0]?.[0]).toMatchObject({sharesState: false});
  });

  it('throws naming the package and every install folder when copies do not share state in strict mode', () => {
    registerCopy({variant: 'x', key: 'test/pkg/v1'});
    registerCopy({variant: 'y', key: 'test/pkg/v2'});

    expect(() => reportDuplicatePackageCopies({strict: true})).toThrow(
      'Installed copies of these packages do not share their state: @shipfox/pkg (/app/node_modules/.pnpm/@shipfox+pkg@1.0.0_x/node_modules/@shipfox/pkg, /app/node_modules/.pnpm/@shipfox+pkg@1.0.0_y/node_modules/@shipfox/pkg)',
    );
  });
});
