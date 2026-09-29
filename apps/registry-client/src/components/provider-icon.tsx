import {IntegrationIcon} from '@shipfox/integration-icons';
import {Icon} from '@shipfox/react-ui/icon';
import {providerLabel} from '@/lib/providers';

export function ProviderIcon({provider, className}: {provider: string; className?: string}) {
  const label = providerLabel(provider);
  // Shipfox is not an integration source, but templates name it for their own steps.
  if (provider === 'shipfox') {
    return <Icon name="shipfox" role="img" aria-label={label} className={className} />;
  }
  return <IntegrationIcon source={provider} role="img" aria-label={label} className={className} />;
}

export function ProviderIcons({providers}: {providers: readonly string[]}) {
  return (
    <span className="flex items-center gap-inline">
      {providers.map((provider) => (
        <span key={provider} title={providerLabel(provider)} className="flex">
          <ProviderIcon provider={provider} className="size-16" />
        </span>
      ))}
    </span>
  );
}
