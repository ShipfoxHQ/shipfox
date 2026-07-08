import {
  DEFAULT_HARNESS,
  type Harness,
  type HarnessDescriptor,
  harnessSupportsProvider,
  listHarnessDescriptors,
  type ModelProviderCatalogEntryDto,
} from '@shipfox/api-agent-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useEffect, useMemo, useState} from 'react';
import {AvailableProvidersGrid, PROVIDER_GRID_CLASS} from '#components/available-providers-grid.js';
import {modelProviderConfigErrorToFormError} from '#components/form-errors.js';
import {ModelProviderTestAndSaveForm} from '#components/test-and-save-form.js';
import {
  useModelProviderCatalogQuery,
  useSetDefaultHarnessMutation,
} from '#hooks/api/model-providers.js';
import {dismissModelProviderOnboarding} from '#state/model-provider-onboarding.js';

const SURFACE_CLASS =
  'overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base';

export function ModelProviderOnboardingPage({
  workspaceId,
  onSkip,
  onConfigured,
}: {
  workspaceId: string;
  onSkip: () => void;
  onConfigured: () => void;
}) {
  const catalogQuery = useModelProviderCatalogQuery();
  const setDefaultHarness = useSetDefaultHarnessMutation();
  const [selectedHarness, setSelectedHarness] = useState<Harness | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ModelProviderCatalogEntryDto | null>(null);
  const [defaultHarnessError, setDefaultHarnessError] = useState<string | undefined>();
  const [isSettingDefaultHarness, setIsSettingDefaultHarness] = useState(false);
  const supportedProviders =
    catalogQuery.data?.providers.filter((provider) => provider.support_status === 'supported') ??
    [];
  const filteredProviders = useMemo(() => {
    if (selectedHarness === null) return [];
    return supportedProviders.filter((provider) =>
      harnessSupportsProvider(selectedHarness, provider.id),
    );
  }, [selectedHarness, supportedProviders]);

  useEffect(() => {
    document
      .getElementById(
        selectedHarness === null ? 'model-provider-harness-step' : 'model-provider-provider-step',
      )
      ?.focus();
  }, [selectedHarness]);

  function handleSkip() {
    try {
      dismissModelProviderOnboarding(workspaceId);
    } catch {
      // Skip is best-effort persistence; access to the product must not depend on storage.
    }
    onSkip();
  }

  async function handleProviderSaved() {
    if (selectedEntry === null || selectedHarness === null) return;

    setDefaultHarnessError(undefined);
    if (selectedHarness === DEFAULT_HARNESS) {
      toast.success(`${selectedEntry.label} saved`);
      onConfigured();
      return;
    }

    setIsSettingDefaultHarness(true);
    try {
      await setDefaultHarness.mutateAsync({
        workspaceId,
        body: {harness_id: selectedHarness},
      });
      toast.success(`${selectedEntry.label} saved`);
      onConfigured();
    } catch (error) {
      const mapped = modelProviderConfigErrorToFormError(error);
      setDefaultHarnessError(mapped.message || 'Could not save default harness. Try again.');
    } finally {
      setIsSettingDefaultHarness(false);
    }
  }

  const selectedHarnessDescriptor =
    selectedHarness === null
      ? null
      : listHarnessDescriptors().find((harness) => harness.id === selectedHarness);
  const headingId =
    selectedHarness === null ? 'model-provider-harness-step' : 'model-provider-provider-step';

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
      <header className="flex flex-col gap-12">
        <div className="flex items-start justify-between gap-16 max-[520px]:flex-col max-[520px]:gap-8">
          <Header id={headingId} variant="h1" tabIndex={-1} className="outline-none">
            {selectedHarnessDescriptor
              ? `Configure ${selectedHarnessDescriptor.label}`
              : 'Choose agent harness'}
          </Header>
          <Button type="button" variant="secondary" onClick={handleSkip} className="shrink-0">
            Skip for now
          </Button>
        </div>
        <Text size="md" className="text-foreground-neutral-muted">
          {selectedHarnessDescriptor
            ? `${selectedHarnessDescriptor.label} needs a compatible model provider. Add your own API key, or go back to choose a different harness.`
            : 'A harness runs agent steps. Choose the engine you want first, then connect a compatible model provider.'}
        </Text>
      </header>

      <section aria-labelledby={headingId} className="flex flex-col gap-16">
        {selectedHarness === null ? (
          <HarnessPicker onSelect={setSelectedHarness} />
        ) : (
          <>
            <div>
              <Button type="button" variant="transparent" onClick={() => setSelectedHarness(null)}>
                Back
              </Button>
            </div>
            <ModelProviderPicker
              key={selectedHarness}
              catalogQuery={catalogQuery}
              supportedProviders={filteredProviders}
              onSelect={(entry) => {
                setDefaultHarnessError(undefined);
                setSelectedEntry(entry);
              }}
            />
          </>
        )}
      </section>

      <Modal
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open && !isSettingDefaultHarness) {
            setSelectedEntry(null);
            setDefaultHarnessError(undefined);
          }
        }}
      >
        <ModalContent aria-describedby={undefined}>
          <ModalTitle className="sr-only">
            {selectedEntry ? `Configure ${selectedEntry.label}` : ''}
          </ModalTitle>
          <ModalHeader>
            <Text
              size="lg"
              aria-hidden="true"
              className="overflow-ellipsis overflow-hidden whitespace-nowrap"
            >
              {selectedEntry ? `Configure ${selectedEntry.label}` : ''}
            </Text>
          </ModalHeader>
          {isSettingDefaultHarness ? (
            <div role="status" className="px-20 pb-8">
              <Text size="sm" className="text-foreground-neutral-muted">
                Saving harness default...
              </Text>
            </div>
          ) : null}
          {defaultHarnessError ? (
            <div className="px-20 pb-8">
              <Callout role="alert" type="error">
                <div className="flex flex-col gap-8">
                  <Text size="sm" bold>
                    Could not save default harness
                  </Text>
                  <Text size="sm">{defaultHarnessError}</Text>
                </div>
              </Callout>
            </div>
          ) : null}
          {selectedEntry ? (
            <ModelProviderTestAndSaveForm
              workspaceId={workspaceId}
              entry={selectedEntry}
              setAsDefaultOnSave
              onSaved={() => {
                void handleProviderSaved();
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>
    </div>
  );
}

function HarnessPicker({onSelect}: {onSelect: (harness: Harness) => void}) {
  return (
    <ul className={PROVIDER_GRID_CLASS} aria-label="Agent harnesses">
      {listHarnessDescriptors().map((harness) => (
        <HarnessCard key={harness.id} harness={harness} onChoose={() => onSelect(harness.id)} />
      ))}
    </ul>
  );
}

function HarnessCard({harness, onChoose}: {harness: HarnessDescriptor; onChoose: () => void}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          'group block w-full cursor-pointer p-16 text-left outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
          SURFACE_CLASS,
        )}
        aria-label={`Choose ${harness.label}`}
        onClick={onChoose}
      >
        <div className="flex min-w-0 items-center justify-between gap-12">
          <div className="flex min-w-0 flex-col gap-4">
            <Text size="md" bold className="min-w-0 truncate">
              {harness.label}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              {harness.description}
            </Text>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-foreground-neutral-muted transition-colors group-hover:text-foreground-highlight-interactive">
            <Text size="sm">Choose</Text>
            <Icon name="chevronRight" className="size-16" />
          </div>
        </div>
      </button>
    </li>
  );
}

function ModelProviderPicker({
  catalogQuery,
  supportedProviders,
  onSelect,
}: {
  catalogQuery: ReturnType<typeof useModelProviderCatalogQuery>;
  supportedProviders: ModelProviderCatalogEntryDto[];
  onSelect: (entry: ModelProviderCatalogEntryDto) => void;
}) {
  if (catalogQuery.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading model providers">
        <ModelProviderGridSkeleton />
      </div>
    );
  }

  if (catalogQuery.isError && catalogQuery.data === undefined) {
    return <QueryLoadError query={catalogQuery} subject="model provider catalog" />;
  }

  if (catalogQuery.data !== undefined && supportedProviders.length === 0) {
    return (
      <EmptyState
        icon="componentLine"
        title="No providers available to configure"
        description="Skip for now and add one later from workspace settings."
      />
    );
  }

  return <AvailableProvidersGrid entries={supportedProviders} onSelect={onSelect} />;
}

function ModelProviderGridSkeleton() {
  return (
    <div className={PROVIDER_GRID_CLASS}>
      {[0, 1, 2, 3].map((card) => (
        <Skeleton key={card} className="h-136 w-full" />
      ))}
    </div>
  );
}
