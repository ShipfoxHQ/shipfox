import type {AgentProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
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
import {AvailableProviderCard} from '#components/available-provider-card.js';
import {AgentProviderTestAndSaveForm} from '#components/test-and-save-form.js';
import {useAgentProviderCatalogQuery} from '#hooks/api/agent-providers.js';
import {dismissAgentProviderOnboarding} from '#state/agent-provider-onboarding.js';

export function AgentProviderOnboardingPage({
  workspaceId,
  onSkip,
  onConfigured,
}: {
  workspaceId: string;
  onSkip: () => void;
  onConfigured: () => void;
}) {
  const catalogQuery = useAgentProviderCatalogQuery();
  const [selectedEntry, setSelectedEntry] = useState<AgentProviderCatalogEntryDto | null>(null);
  const supportedProviders =
    catalogQuery.data?.providers.filter((provider) => provider.support_status === 'supported') ??
    [];

  function handleSkip() {
    try {
      dismissAgentProviderOnboarding(workspaceId);
    } catch {
      // Skip is best-effort persistence; access to the product must not depend on storage.
    }
    onSkip();
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
      <header className="flex flex-col gap-8">
        <Header variant="h1">Configure agent provider</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Agent jobs need an LLM provider. Add your own API key, or skip - Shipfox runs them with
          the instance default provider. You can add this anytime in Settings &gt; Agent Providers.
        </Text>
      </header>

      <ProviderPicker
        catalogQuery={catalogQuery}
        supportedProviders={supportedProviders}
        onSelect={setSelectedEntry}
      />

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={handleSkip}>
          Skip for now
        </Button>
      </div>

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
            <AgentProviderTestAndSaveForm
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

function ProviderPicker({
  catalogQuery,
  supportedProviders,
  onSelect,
}: {
  catalogQuery: ReturnType<typeof useAgentProviderCatalogQuery>;
  supportedProviders: AgentProviderCatalogEntryDto[];
  onSelect: (entry: AgentProviderCatalogEntryDto) => void;
}) {
  if (catalogQuery.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading agent providers">
        <ProviderGridSkeleton />
      </div>
    );
  }

  if (catalogQuery.isError && catalogQuery.data === undefined) {
    return <QueryLoadError query={catalogQuery} subject="agent provider catalog" />;
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

  return (
    <ul className="grid grid-cols-2 gap-12 max-[760px]:grid-cols-1">
      {supportedProviders.map((entry) => (
        <AvailableProviderCard key={entry.id} entry={entry} onConfigure={() => onSelect(entry)} />
      ))}
    </ul>
  );
}

function ProviderGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-12 max-[760px]:grid-cols-1">
      {[0, 1, 2, 3].map((card) => (
        <Skeleton key={card} className="h-136 w-full" />
      ))}
    </div>
  );
}
