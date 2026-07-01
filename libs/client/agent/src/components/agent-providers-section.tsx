import type {AgentProviderCatalogEntryDto, AgentProviderConfigDto} from '@shipfox/api-agent-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Alert,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Header,
  Icon,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Skeleton,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@shipfox/react-ui';
import {useEffect, useMemo, useRef, useState} from 'react';
import {
  useAgentProviderCatalogQuery,
  useAgentProviderConfigsQuery,
  useDeleteAgentProviderConfigMutation,
  useSetDefaultAgentProviderMutation,
} from '#hooks/api/agent-providers.js';
import {AgentProviderUsageModal} from './agent-provider-usage-modal.js';
import {AvailableProvidersGrid, PROVIDER_GRID_CLASS} from './available-providers-grid.js';
import {ChangeDefaultModelForm} from './change-default-model-form.js';
import {agentProviderConfigErrorToFormError} from './form-errors.js';
import {
  isSupportedCatalogEntry,
  type SupportedAgentProviderCatalogEntry,
  toSupportedCatalogEntry,
} from './supported-agent-provider-catalog-entry.js';
import {AgentProviderTestAndSaveForm} from './test-and-save-form.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

type ProviderFormState =
  | {mode: 'configure'; entry: SupportedAgentProviderCatalogEntry; config?: undefined}
  | {mode: 'edit'; entry: SupportedAgentProviderCatalogEntry; config: AgentProviderConfigDto};
type ModelFormState = {entry: SupportedAgentProviderCatalogEntry; config: AgentProviderConfigDto};
type UsageTarget = {
  entry: SupportedAgentProviderCatalogEntry;
  initialModel: string | null;
  restoreFocusToConfiguredProviders: boolean;
};

const USAGE_MODAL_OPEN_DELAY_MS = 250;

export function WorkspaceAgentProvidersSection({workspaceId}: {workspaceId: string}) {
  const catalogQuery = useAgentProviderCatalogQuery();
  const configsQuery = useAgentProviderConfigsQuery(workspaceId);
  const [formState, setFormState] = useState<ProviderFormState | null>(null);
  const [modelFormState, setModelFormState] = useState<ModelFormState | null>(null);
  const [usageTarget, setUsageTarget] = useState<UsageTarget | null>(null);
  const [pendingUsageTarget, setPendingUsageTarget] = useState<UsageTarget | null>(null);
  const configuredProvidersRegionRef = useRef<HTMLElement | null>(null);

  const providers = catalogQuery.data?.providers ?? [];
  const configs = configsQuery.data?.configs ?? [];
  const configsLoaded = configsQuery.data !== undefined;
  const defaultProviderId = configsQuery.data?.default_provider_id ?? null;
  const providerById = useMemo(
    () =>
      new Map<string, AgentProviderCatalogEntryDto>(
        providers.map((provider) => [provider.id, provider]),
      ),
    [providers],
  );
  const configuredIds = useMemo(
    () => new Set<string>(configs.map((config) => config.provider_id)),
    [configs],
  );
  const availableProviders = configsLoaded
    ? providers.filter(
        (provider): provider is SupportedAgentProviderCatalogEntry =>
          isSupportedCatalogEntry(provider) && !configuredIds.has(provider.id),
      )
    : [];
  const unsupportedProviders = providers.filter(
    (provider) => provider.support_status === 'unsupported',
  );

  function closeForm() {
    setFormState(null);
  }

  function closeModelForm() {
    setModelFormState(null);
  }

  useEffect(() => {
    if (pendingUsageTarget === null || formState !== null) return undefined;

    const timer = window.setTimeout(() => {
      setUsageTarget(pendingUsageTarget);
      setPendingUsageTarget(null);
    }, USAGE_MODAL_OPEN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [formState, pendingUsageTarget]);

  return (
    <div className="flex min-w-0 flex-col gap-32">
      <section
        ref={configuredProvidersRegionRef}
        className="flex flex-col gap-16 outline-none"
        aria-label="Configured providers"
        tabIndex={-1}
      >
        <div className="flex flex-col gap-4">
          <Header variant="h3">Configured providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Workspace credentials available to agent steps.
          </Text>
        </div>

        {configsQuery.isPending ? (
          <ProviderRowsSkeleton label="Loading configured providers" />
        ) : null}

        {configsQuery.isError && configsQuery.data === undefined ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <QueryLoadError query={configsQuery} subject="agent provider configs" />
          </div>
        ) : null}

        {configsQuery.data !== undefined && configs.length === 0 ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <EmptyState
              icon="key2Line"
              title="No providers configured"
              description="Configure a provider below to run agent steps with workspace-managed credentials."
            />
          </div>
        ) : null}

        {configs.length > 0 ? (
          <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
            {configs.map((config) => {
              const entry = toSupportedCatalogEntry(providerById.get(config.provider_id));
              return (
                <ConfiguredProviderRow
                  key={config.provider_id}
                  workspaceId={workspaceId}
                  config={config}
                  entry={entry}
                  isDefault={config.provider_id === defaultProviderId}
                  onEdit={() => {
                    if (entry) setFormState({mode: 'edit', entry, config});
                  }}
                  onChangeDefaultModel={() => {
                    if (entry) setModelFormState({entry, config});
                  }}
                  onShowUsage={() => {
                    if (entry) {
                      setPendingUsageTarget(null);
                      setUsageTarget({
                        entry,
                        initialModel: config.default_model,
                        restoreFocusToConfiguredProviders: false,
                      });
                    }
                  }}
                />
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-16" aria-label="Available providers">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Available providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Providers that can be configured for agent steps in this workspace.
          </Text>
        </div>

        {catalogQuery.isPending || configsQuery.isPending ? <ProviderGridSkeleton /> : null}

        {catalogQuery.isError && catalogQuery.data === undefined ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <QueryLoadError query={catalogQuery} subject="agent provider catalog" />
          </div>
        ) : null}

        {catalogQuery.data !== undefined && configsLoaded && availableProviders.length === 0 ? (
          <div className={cn(SURFACE_CLASS, 'px-16')}>
            <EmptyState
              icon="componentLine"
              title="No available providers"
              description="All supported providers are already configured for this workspace."
            />
          </div>
        ) : null}

        {configsLoaded && availableProviders.length > 0 ? (
          <AvailableProvidersGrid
            entries={availableProviders}
            onSelect={(entry) => setFormState({mode: 'configure', entry})}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-16" aria-label="Unsupported providers">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Unsupported providers</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Providers that cannot be configured in this workspace yet.
          </Text>
        </div>

        {catalogQuery.isPending ? (
          <ProviderRowsSkeleton label="Loading unsupported providers" />
        ) : null}

        {unsupportedProviders.length > 0 ? (
          <ul className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}>
            {unsupportedProviders.map((entry) => (
              <li key={entry.id} className="flex items-start gap-12 px-16 py-12 opacity-70">
                <Icon
                  name="forbid2Line"
                  className="mt-2 size-18 shrink-0 text-foreground-neutral-muted"
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Text size="md" bold className="truncate">
                    {entry.label}
                  </Text>
                  <Text size="sm" className="text-foreground-neutral-muted">
                    {entry.unsupported_reason}
                  </Text>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Modal open={formState !== null} onOpenChange={(open) => (open ? undefined : closeForm())}>
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">{providerFormTitle(formState)}</ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              {providerFormTitle(formState)}
            </Text>
          </ModalHeader>
          {formState ? (
            <AgentProviderTestAndSaveForm
              workspaceId={workspaceId}
              entry={formState.entry}
              existingConfig={formState.config}
              onSaved={(savedDefaultModel) => {
                toast.success(`${formState.entry.label} saved`);
                if (formState.mode === 'configure' && configs.length === 0) {
                  setPendingUsageTarget({
                    entry: formState.entry,
                    initialModel: savedDefaultModel,
                    restoreFocusToConfiguredProviders: true,
                  });
                }
                closeForm();
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <Modal
        open={modelFormState !== null}
        onOpenChange={(open) => (open ? undefined : closeModelForm())}
      >
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">Change default model</ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              Change default model for {modelFormState?.entry.label}
            </Text>
          </ModalHeader>
          {modelFormState ? (
            <ChangeDefaultModelForm
              workspaceId={workspaceId}
              entry={modelFormState.entry}
              config={modelFormState.config}
              onSaved={() => {
                toast.success(`${modelFormState.entry.label} default model saved`);
                closeModelForm();
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <AgentProviderUsageModal
        entry={usageTarget?.entry ?? null}
        initialModel={usageTarget?.initialModel ?? null}
        open={usageTarget !== null}
        closeFocusTarget={
          usageTarget?.restoreFocusToConfiguredProviders
            ? configuredProvidersRegionRef.current
            : null
        }
        onOpenChange={(open) => {
          if (!open) setUsageTarget(null);
        }}
      />
    </div>
  );
}

function providerFormTitle(formState: ProviderFormState | null): string {
  if (formState === null) return '';
  if (formState.mode === 'edit') return `Edit credentials for ${formState.entry.label}`;
  return `Configure ${formState.entry.label}`;
}

function ConfiguredProviderRow({
  workspaceId,
  config,
  entry,
  isDefault,
  onEdit,
  onChangeDefaultModel,
  onShowUsage,
}: {
  workspaceId: string;
  config: AgentProviderConfigDto;
  entry: SupportedAgentProviderCatalogEntry | undefined;
  isDefault: boolean;
  onEdit: () => void;
  onChangeDefaultModel: () => void;
  onShowUsage: () => void;
}) {
  const setDefault = useSetDefaultAgentProviderMutation();
  const deleteConfig = useDeleteAgentProviderConfigMutation();
  const [defaultError, setDefaultError] = useState<string | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const label = entry?.label ?? config.provider_id;

  async function handleSetDefault() {
    setDefaultError(undefined);
    try {
      await setDefault.mutateAsync({
        workspaceId,
        body: {provider_id: config.provider_id},
      });
      toast.success(`${label} is now the default provider`);
    } catch (error) {
      const mapped = agentProviderConfigErrorToFormError(error);
      setDefaultError(mapped.message);
    }
  }

  async function handleDelete() {
    if (!entry) return;

    setDeleteError(undefined);
    try {
      await deleteConfig.mutateAsync({workspaceId, providerId: entry.id});
      toast.success(`${label} deleted`);
      setDeleteOpen(false);
    } catch (error) {
      const mapped = agentProviderConfigErrorToFormError(error);
      setDeleteError(mapped.message);
    }
  }

  function handleDeleteOpenChange(nextOpen: boolean) {
    setDeleteOpen(nextOpen);
    if (nextOpen) {
      setDeleteError(undefined);
      deleteConfig.reset();
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
                <TooltipContent>Default provider</TooltipContent>
              </Tooltip>
              <span className="sr-only">Default provider</span>
            </>
          ) : null}
          <Text size="md" bold className="truncate">
            {label}
          </Text>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Open ${label} provider actions`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isDefault ? (
              <DropdownMenuItem
                icon="starLine"
                disabled={setDefault.isPending}
                onSelect={() => {
                  void handleSetDefault();
                }}
              >
                Set as default
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              icon="settings3Line"
              disabled={!entry}
              onSelect={onChangeDefaultModel}
            >
              Change default model
            </DropdownMenuItem>
            <DropdownMenuItem icon="bookOpenLine" disabled={!entry} onSelect={onShowUsage}>
              View workflow example
            </DropdownMenuItem>
            <DropdownMenuItem icon="editLine" disabled={!entry} onSelect={onEdit}>
              Edit credentials
            </DropdownMenuItem>
            <DropdownMenuItem
              icon="deleteBinLine"
              disabled={!entry}
              onSelect={() => {
                setDeleteOpen(true);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {defaultError ? (
        <Alert variant="error" animated={false}>
          <Text size="sm">{defaultError}</Text>
        </Alert>
      ) : null}
      <DeleteProviderDialog
        open={deleteOpen}
        onOpenChange={handleDeleteOpenChange}
        label={label}
        errorMessage={deleteError}
        isLoading={deleteConfig.isPending}
        onDelete={handleDelete}
      />
    </li>
  );
}

function DeleteProviderDialog({
  open,
  onOpenChange,
  label,
  errorMessage,
  isLoading,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  errorMessage: string | undefined;
  isLoading: boolean;
  onDelete: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent aria-describedby={undefined} className="max-w-[420px]">
        <ModalTitle className="sr-only">Delete agent provider</ModalTitle>
        <ModalHeader title="Delete agent provider" />
        <ModalBody className="gap-16">
          <Text size="sm" className="text-foreground-neutral-muted">
            Delete {label} credentials from this workspace? Agent jobs cannot use this provider
            until it is configured again.
          </Text>
          {errorMessage ? (
            <Alert variant="error" animated={false}>
              <Text size="sm">{errorMessage}</Text>
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" isLoading={isLoading} onClick={onDelete}>
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ProviderRowsSkeleton({label}: {label: string}) {
  return (
    <ul
      role="status"
      aria-label={label}
      className={cn('divide-y divide-border-neutral-base', SURFACE_CLASS)}
    >
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-12 px-16 py-12">
          <Skeleton className="size-32 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Skeleton className="h-16 w-120" />
            <Skeleton className="h-14 w-180" />
          </div>
          <Skeleton className="h-28 w-96 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function ProviderGridSkeleton() {
  return (
    <div role="status" aria-label="Loading available providers" className={PROVIDER_GRID_CLASS}>
      {[0, 1, 2, 3].map((card) => (
        <Skeleton key={card} className="h-136 w-full" />
      ))}
    </div>
  );
}
