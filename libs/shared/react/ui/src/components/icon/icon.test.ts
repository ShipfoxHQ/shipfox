import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Icon, type IconName} from './icon.js';

const customIconNames = [
  'badge',
  'checkCircleSolid',
  'circleDottedLine',
  'componentFill',
  'componentLine',
  'ellipseMiniSolid',
  'gitea',
  'infoTooltipFill',
  'resize',
  'sentry',
  'shipfox',
  'slack',
  'spinner',
  'stripe',
  'thunder',
  'xCircleSolid',
] as const satisfies IconName[];

describe('custom icons', () => {
  it.each(customIconNames)('forwards base icon props for %s', (name) => {
    const markup = renderToStaticMarkup(
      createElement(Icon, {
        name,
        size: 16,
        className: 'custom-icon',
        'aria-label': 'Custom icon',
      }),
    );

    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain('class="custom-icon"');
    expect(markup).toContain('aria-label="Custom icon"');
    expect(markup).not.toContain('aria-hidden');
  });
});
