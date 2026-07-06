import {
  DEFAULT_HARNESS,
  type HarnessDescriptor,
  listHarnessDescriptors,
} from '@shipfox/api-agent-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Alert} from '@shipfox/react-ui/alert';
import {IconButton} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {Icon} from '@shipfox/react-ui/icon';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useState} from 'react';
import {
  useModelProviderConfigsQuery,
  useSetDefaultHarnessMutation,
} from '#hooks/api/model-providers.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';
import {isHarnessAvailable} from './harness-availability.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function WorkspaceHarnessesSection({workspaceId}: {workspaceId: string}) {
  const configsQuery = useModelProviderConfigsQuery(workspaceId);
  const configs = configsQuery.data?.configs ?? [];
  const defaultHarnessId = configsQuery.data?.default_harness_id ?? DEFAULT_HARNESS;

  return (
    <section className="flex flex-col gap-16" aria-label="Harnesses">
      <div className="flex flex-col gap-4">
        <Header variant="h3">Harnesses</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Harnesses are the engines that run agent steps; each uses a model provider's credentials.
        </Text>
      </div>

      {configsQuery.isPending ? <HarnessRowsSkeleton /> : null}

      {configsQuery.isError && configsQuery.data === undefined ? (
        <div className={cn(SURFACE_CLASS, 'px-16')}>
          <QueryLoadError query={configsQuery} subject="harnesses" />
        </div>
      ) : null}

      {configsQuery.data !== undefined ? (
        <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
          {listHarnessDescriptors().map((harness) => (
            <HarnessRow
              key={harness.id}
              workspaceId={workspaceId}
              harness={harness}
              isDefault={harness.id === defaultHarnessId}
              isAvailable={isHarnessAvailable(harness, configs)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function HarnessRow({
  workspaceId,
  harness,
  isDefault,
  isAvailable,
}: {
  workspaceId: string;
  harness: HarnessDescriptor;
  isDefault: boolean;
  isAvailable: boolean;
}) {
  const setDefaultHarness = useSetDefaultHarnessMutation();
  const [defaultError, setDefaultError] = useState<string | undefined>();
  const unavailableCopy = harnessUnavailableCopy(isDefault);

  async function handleSetDefault() {
    setDefaultError(undefined);
    try {
      await setDefaultHarness.mutateAsync({
        workspaceId,
        body: {harness_id: harness.id},
      });
      toast.success(`${harness.label} is now the default harness`);
    } catch (error) {
      const mapped = modelProviderConfigErrorToFormError(error);
      setDefaultError(mapped.message || 'Could not save default harness. Try again.');
    }
  }

  return (
    <li className="flex flex-col gap-10 px-16 py-12 transition-colors hover:bg-background-components-hover">
      <div className="flex items-center justify-between gap-12">
        <div className="flex min-w-0 items-center gap-8">
          {isDefault ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex size-16 shrink-0 items-center justify-center">
                    <Icon
                      name="starLine"
                      className="size-16 text-foreground-neutral-muted"
                      aria-hidden
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Default harness</TooltipContent>
              </Tooltip>
              <span className="sr-only">Default harness</span>
            </>
          ) : null}
          <Text size="md" bold className="truncate">
            {harness.label}
          </Text>
          {!isAvailable ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex size-16 shrink-0 items-center justify-center">
                    <Icon
                      name="errorWarningLine"
                      className="size-16 text-foreground-warning-base"
                      aria-hidden
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{unavailableCopy}</TooltipContent>
              </Tooltip>
              <span className="sr-only">{unavailableCopy}</span>
            </>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Open ${harness.label} harness actions`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isDefault ? (
              <DropdownMenuItem
                icon="starLine"
                disabled={setDefaultHarness.isPending || !isAvailable}
                onSelect={() => {
                  void handleSetDefault();
                }}
              >
                Set as default
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {defaultError ? (
        <Alert variant="error" animated={false}>
          <Text size="sm">{defaultError}</Text>
        </Alert>
      ) : null}
    </li>
  );
}

function harnessUnavailableCopy(isDefault: boolean): string {
  const base = 'Configure a compatible model provider to use this harness.';
  if (!isDefault) return base;
  return `${base} The stored default harness cannot currently run in this workspace.`;
}

function HarnessRowsSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading harnesses"
      className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}
    >
      {[0, 1].map((row) => (
        <li key={row} className="flex items-center gap-12 px-16 py-12">
          <Skeleton className="size-16 shrink-0" />
          <Skeleton className="h-16 w-120" />
          <Skeleton className="ml-auto size-28 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
