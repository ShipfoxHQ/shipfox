import type {AgentProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {cn, Text} from '@shipfox/react-ui';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function AvailableProviderCard({
  entry,
  onConfigure,
}: {
  entry: AgentProviderCatalogEntryDto;
  onConfigure: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'block w-full cursor-pointer px-14 py-10 text-left outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
          SURFACE_CLASS,
        )}
        aria-label={`Configure ${entry.label}`}
        onClick={onConfigure}
      >
        <div className="min-w-0 flex-1">
          <Text size="md" bold className="truncate">
            {entry.label}
          </Text>
        </div>
      </button>
    </li>
  );
}
