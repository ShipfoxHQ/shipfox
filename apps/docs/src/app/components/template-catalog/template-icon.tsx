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
import {type TemplateIcon as Icon, templateIconLabels} from '@/lib/template-catalog/types';

const brandIcons = {
  clickup: siClickup,
  github: siGithub,
  jira: siJira,
  linear: siLinear,
  notion: siNotion,
  posthog: siPosthog,
  sentry: siSentry,
  slack: siSlack,
};

export function TemplateIcon({
  icon,
  className = 'size-4',
  labelled = false,
}: {
  icon: Icon;
  className?: string;
  labelled?: boolean;
}) {
  const svg =
    icon === 'shipfox' ? (
      <svg
        aria-hidden="true"
        viewBox="0 0 200 200"
        className={`${className} shrink-0 fill-current`}
      >
        <path d="M35.4766 71.1779L87.8471 174.764C92.9421 184.842 107.058 184.842 112.153 174.764L164.523 71.1779L192.438 85.4265C200.787 89.6883 202.593 101.048 195.992 107.787L109.671 195.911C104.33 201.363 95.6704 201.363 90.3295 195.911L4.0079 107.787C-2.59278 101.048 -0.787007 89.6883 7.56226 85.4265L35.4766 71.1779ZM100 38.2425L171.913 1.53536C183.748 -4.50572 196.251 8.42284 190.182 20.4265L164.523 71.1779L100 38.2425ZM100 38.2425L28.0872 1.53536C16.2522 -4.50571 3.74943 8.42284 9.81817 20.4265L35.4766 71.1779L100 38.2425Z" />
      </svg>
    ) : (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-current`}>
        <path d={brandIcons[icon].path} />
      </svg>
    );

  if (!labelled) return svg;
  return (
    <span role="img" aria-label={templateIconLabels[icon]} className="inline-flex">
      {svg}
    </span>
  );
}
