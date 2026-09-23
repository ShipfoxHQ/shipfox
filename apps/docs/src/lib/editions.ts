export type EditionFeature = {
  label: string;
  detail?: string;
  href?: string;
};

export type Edition = {
  id: string;
  name: string;
  price: string;
  summary: string;
  infrastructure: {
    deployment: string;
    compute: EditionFeature;
    inference: EditionFeature;
  };
  features: readonly EditionFeature[];
  access: readonly string[];
  action: {label: string; href: string};
  secondaryAction?: {label: string; href: string};
  featured?: boolean;
};

export const editions: readonly Edition[] = [
  {
    id: 'community-edition',
    name: 'Community edition',
    price: 'Free',
    summary: 'Open source under the MIT license.',
    infrastructure: {
      deployment: 'Self-hosted',
      compute: {label: 'Bring your own compute'},
      inference: {label: 'Bring your own model provider keys'},
    },
    features: [{label: 'Community support'}],
    access: ['Email/password authentication', 'No user roles'],
    action: {label: 'View source', href: 'https://github.com/ShipfoxHQ/shipfox'},
    secondaryAction: {label: 'Self-hosting guide', href: '/installation/self-hosting'},
  },
  {
    id: 'shipfox-cloud',
    name: 'Shipfox Cloud',
    price: 'Pay as you go',
    summary: 'Managed by Shipfox. Pay for what you use.',
    infrastructure: {
      deployment: 'Hosted by Shipfox',
      compute: {
        label: 'Hosted runners',
        detail: 'Per-minute prices',
        href: '/reference/runner-labels',
      },
      inference: {
        label: 'Managed agent models',
        detail: 'Usage prices, no provider setup',
        href: '/reference/cloud-models',
      },
    },
    features: [{label: 'Auditability and advanced analytics'}, {label: 'Community support'}],
    access: ['Sign in with GitHub, Google, or Microsoft', 'Pre-defined user roles'],
    action: {label: 'Get started', href: 'https://app.shipfox.io'},
    featured: true,
  },
  {
    id: 'enterprise-edition',
    name: 'Enterprise edition',
    price: "Let's talk",
    summary: 'Everything in Shipfox Cloud, with self-hosting and your own compute and model keys.',
    infrastructure: {
      deployment: 'Shipfox Cloud or self-hosted',
      compute: {label: 'Hosted runners or bring your own compute'},
      inference: {label: 'Managed models or bring your own model provider keys'},
    },
    features: [{label: 'Dedicated support and onboarding'}],
    access: ['SAML single sign-on (SSO)'],
    action: {
      label: 'Contact Shipfox',
      href: 'mailto:noe.charmet@shipfox.io?subject=Shipfox%20Enterprise',
    },
  },
];

export function serializeEditionsComparison(): string {
  return editions
    .map((edition) =>
      [
        `## ${edition.name}`,
        '',
        `**${edition.price}.** ${edition.summary}`,
        '',
        '### Infrastructure',
        '',
        `- Deployment: ${edition.infrastructure.deployment}`,
        `- Compute: ${serializeFeature(edition.infrastructure.compute)}`,
        `- Inference: ${serializeFeature(edition.infrastructure.inference)}`,
        '',
        '### Authentication and permissions',
        '',
        ...edition.access.map((item) => `- ${item}`),
        '',
        '### Features and support',
        '',
        ...edition.features.map((feature) => `- ${serializeFeature(feature)}`),
        '',
        ...(edition.secondaryAction
          ? [`[${edition.secondaryAction.label}](${edition.secondaryAction.href})`]
          : []),
        `[${edition.action.label}](${edition.action.href})`,
      ].join('\n'),
    )
    .join('\n\n');
}

function serializeFeature(feature: EditionFeature): string {
  const label = feature.href ? `[${feature.label}](${feature.href})` : feature.label;
  return `${label}${feature.detail ? `: ${feature.detail}` : ''}`;
}
