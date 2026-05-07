import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import {useProjectQuery} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectDetailPage({projectId}: {projectId: string}) {
  const query = useProjectQuery(projectId);
  const errorCopy = query.error ? projectErrorCopy(query.error) : undefined;

  return (
    <div className="flex w-full flex-col gap-24">
      {query.isPending ? (
        <Card className="p-24">
          <Skeleton className="h-28 w-1/3" />
          <Skeleton className="h-18 w-1/2" />
        </Card>
      ) : null}

      {query.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              {errorCopy?.title ?? 'Project unavailable'}
            </Text>
            <Text size="sm">
              {query.error && 'status' in query.error && query.error.status === 404
                ? 'This project was not found.'
                : errorCopy?.message}
            </Text>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {query.data ? (
        <section className="grid gap-18 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="p-20">
            <CardHeader>
              <CardTitle variant="h2">Source identity</CardTitle>
              <CardDescription>Source-control binding for this project.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-12 sm:grid-cols-2">
              <Metadata label="Connection id" value={query.data.source.connection_id} />
              <Metadata
                label="External repository id"
                value={query.data.source.external_repository_id}
              />
            </CardContent>
          </Card>

          <Card className="p-20">
            <CardHeader>
              <CardTitle variant="h3">Workflow discovery</CardTitle>
              <CardDescription>
                Definitions from .shipfox workflows will appear here in a later phase.
              </CardDescription>
              <StatusBadge variant="success" className="self-start">
                Connected
              </StatusBadge>
            </CardHeader>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Metadata({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0 rounded-8 border border-border-neutral-base bg-background-neutral-base p-14">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="sm" className="break-words">
        {value}
      </Text>
    </div>
  );
}
