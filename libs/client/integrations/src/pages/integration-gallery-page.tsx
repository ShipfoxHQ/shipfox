import {Header, Text} from '@shipfox/react-ui';
import {IntegrationGallerySection} from '#components/integration-gallery-section.js';

export function IntegrationGalleryPage() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-20">
      <header className="flex flex-col gap-8">
        <Header variant="h1">Connect source control</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Shipfox needs a source control integration to import your repositories.
        </Text>
      </header>

      <IntegrationGallerySection
        capability="source_control"
        emptyMessage="Enable at least one source-control provider in the application settings."
      />
    </div>
  );
}
