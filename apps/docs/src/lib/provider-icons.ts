import {
  siClickup,
  siGithub,
  siJira,
  siLinear,
  siNotion,
  siPosthog,
  siSentry,
  siSlack,
} from 'simple-icons';

export interface ProviderGlyph {
  viewBox: string;
  path: string;
  fillRule?: 'evenodd';
}

function simpleIcon({path}: {path: string}): ProviderGlyph {
  return {viewBox: '0 0 24 24', path};
}

/** Single-path provider marks shared by the sidebar and the integration catalog. */
export const providerGlyphs = {
  clickup: simpleIcon(siClickup),
  github: simpleIcon(siGithub),
  jira: simpleIcon(siJira),
  linear: simpleIcon(siLinear),
  notion: simpleIcon(siNotion),
  posthog: simpleIcon(siPosthog),
  sentry: simpleIcon(siSentry),
  slack: simpleIcon(siSlack),
  // Simple Icons has no Jam mark. This copies `JamLogo` from `@shipfox/react-ui`; the eyes are
  // holes, so it needs `evenodd`.
  jam: {
    viewBox: '4.5 4 55 55',
    path: 'M44.339 49.269c-2.53-.044-3.982-.661-5.396-1.252-1.641-.695-3.333-1.417-7.274-1.486-3.942-.068-5.671.593-7.323 1.231-1.422.542-2.895 1.107-5.437 1.063-2.887-.05-5.098-.844-6.585-2.367-1.486-1.523-2.21-3.737-2.158-6.592.133-7.433 2.726-15.867 6.941-22.537 4.49-7.105 10.057-11.135 15.283-11.044 5.226.092 10.645 4.313 14.877 11.57 3.973 6.825 6.263 15.332 6.13 22.765-.051 2.855-.854 5.043-2.394 6.513s-3.778 2.186-6.664 2.136ZM26.13 30.013a2.45 2.45 0 0 1 2.449 2.448v2.3a2.45 2.45 0 0 1-4.897 0v-2.3a2.45 2.45 0 0 1 2.448-2.448Zm11.757 0a2.45 2.45 0 0 1 2.448 2.448v2.3a2.45 2.45 0 0 1-4.897 0v-2.3a2.45 2.45 0 0 1 2.448-2.448ZM32.008 18.12a2.45 2.45 0 0 1 2.45 2.448v2.3a2.45 2.45 0 0 1-4.898 0v-2.3a2.45 2.45 0 0 1 2.448-2.449ZM31.595 50.72c1.718.03 2.807.2 3.567.387s1.321.419 2.139.765l.02.008c1.004.42 2.225.935 3.88 1.261v1.281c0 .778-.941 1.239-1.638.802l-2.698-1.693c-.527-.331-1.248-.154-1.53.375l-1.445 2.721c-.768 1.445-2.996 1.445-3.764 0l-1.445-2.721c-.281-.529-1.003-.706-1.53-.375l-2.699 1.693c-.696.437-1.637-.024-1.637-.802v-1.789c1.229-.272 2.2-.642 3.028-.957l.018-.008c.813-.314 1.383-.526 2.15-.686.768-.16 1.865-.293 3.584-.263Z',
    fillRule: 'evenodd',
  },
} satisfies Record<string, ProviderGlyph>;

export type ProviderGlyphName = keyof typeof providerGlyphs;

export function providerGlyph(name: string): ProviderGlyph | undefined {
  return Object.hasOwn(providerGlyphs, name)
    ? providerGlyphs[name as ProviderGlyphName]
    : undefined;
}
