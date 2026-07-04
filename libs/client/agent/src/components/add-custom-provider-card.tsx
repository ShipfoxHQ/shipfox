import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function AddCustomProviderCard({onConfigure}: {onConfigure: () => void}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'group block h-full w-full cursor-pointer p-16 text-left outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
          SURFACE_CLASS,
        )}
        aria-label="Configure custom provider"
        onClick={onConfigure}
      >
        <Text size="md" bold className="min-w-0 truncate">
          Custom
        </Text>
      </button>
    </li>
  );
}
