import type {ModelProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Button,
  EmptyState,
  Header,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Skeleton,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useState} from 'react';
import {AvailableProvidersGrid, PROVIDER_GRID_CLASS} from '#components/available-providers-grid.js';
import {ModelProviderTestAndSaveForm} from '#components/test-and-save-form.js';
import {useModelProviderCatalogQuery} from '#hooks/api/model-providers.js';
import {dismissModelProviderOnboarding} from '#state/model-provider-onboarding.js';

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
  const [selectedEntry, setSelectedEntry] = useState<ModelProviderCatalogEntryDto | null>(null);
  const supportedProviders =
    catalogQuery.data?.providers.filter((provider) => provider.support_status === 'supported') ??
    [];

  function handleSkip() {
    try {
      dismissModelProviderOnboarding(workspaceId);
    } catch {
      // Skip is best-effort persistence; access to the product must not depend on storage.
    }
    onSkip();
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
      <header className="flex flex-col gap-12">
        <div className="flex items-start justify-between gap-16 max-[520px]:flex-col max-[520px]:gap-8">
          <Header variant="h1">Configure model provider</Header>
          <Button type="button" variant="secondary" onClick={handleSkip} className="shrink-0">
            Skip for now
          </Button>
        </div>
        <Text size="md" className="text-foreground-neutral-muted">
          Agent jobs need a model provider. Add your own API key, or skip - Shipfox runs them with
          the instance default model provider. You can add this anytime in Settings &gt; Model
          Providers.
        </Text>
      </header>

      <ModelProviderPicker
        catalogQuery={catalogQuery}
        supportedProviders={supportedProviders}
        onSelect={setSelectedEntry}
      />

      <Modal
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
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
          {selectedEntry ? (
            <ModelProviderTestAndSaveForm
              workspaceId={workspaceId}
              entry={selectedEntry}
              setAsDefaultOnSave
              onSaved={() => {
                toast.success(`${selectedEntry.label} saved`);
                onConfigured();
              }}
            />
          ) : null}
        </ModalContent>
      </Modal>
    </div>
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
