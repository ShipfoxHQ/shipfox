import {registerModuleMetrics} from './initialize.js';
import type {ShipfoxModule} from './types.js';

describe('registerModuleMetrics', () => {
  it('invokes the metrics hook for each module that declares one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const modules: ShipfoxModule[] = [
      {name: 'first', metrics: first},
      {name: 'second', metrics: second},
    ];

    registerModuleMetrics({modules});

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('skips modules that declare no metrics hook', () => {
    const withMetrics = vi.fn();
    const modules: ShipfoxModule[] = [{name: 'none'}, {name: 'has', metrics: withMetrics}];

    registerModuleMetrics({modules});

    expect(withMetrics).toHaveBeenCalledOnce();
  });

  it('isolates a throwing hook so later modules still register', () => {
    const later = vi.fn();
    const modules: ShipfoxModule[] = [
      {
        name: 'throwing',
        metrics: () => {
          throw new Error('registration failed');
        },
      },
      {name: 'later', metrics: later},
    ];

    registerModuleMetrics({modules});

    expect(later).toHaveBeenCalledOnce();
  });
});
