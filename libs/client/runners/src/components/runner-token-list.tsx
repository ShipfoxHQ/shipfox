import type {RunnerTokenDto} from '@shipfox/api-runners-dto';
import {
  Alert,
  Button,
  Code,
  EmptyState,
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {runnerTokenQueryKeys, useRevokeRunnerTokenMutation} from '#hooks/api/runner-tokens.js';
import {runnerTokenErrorMessage} from './runner-token-errors.js';
import {formatRunnerTokenDate, runnerTokenDisplayName} from './runner-token-format.js';

export function RunnerTokenList({
  workspaceId,
  tokens,
}: {
  workspaceId: string;
  tokens: RunnerTokenDto[];
}) {
  return (
    <>
      <div className="max-[760px]:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.id}>
                <TableCell className="font-medium">{runnerTokenDisplayName(token)}</TableCell>
                <TableCell>
                  <Code variant="paragraph">{token.prefix}</Code>
                </TableCell>
                <TableCell>{formatRunnerTokenDate(token.expires_at)}</TableCell>
                <TableCell>{formatRunnerTokenDate(token.created_at)}</TableCell>
                <TableCell className="text-right">
                  <RevokeRunnerTokenButton workspaceId={workspaceId} token={token} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="hidden flex-col gap-10 max-[760px]:flex" aria-label="Runner tokens">
        {tokens.map((token) => (
          <li
            key={token.id}
            className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-14"
          >
            <div className="flex items-start justify-between gap-12">
              <div className="min-w-0 flex-1">
                <Text size="sm" bold className="truncate">
                  {runnerTokenDisplayName(token)}
                </Text>
                <Code variant="paragraph" className="text-foreground-neutral-muted">
                  {token.prefix}
                </Code>
              </div>
              <RevokeRunnerTokenButton workspaceId={workspaceId} token={token} />
            </div>
            <dl className="mt-12 grid grid-cols-2 gap-10 text-sm">
              <div>
                <dt className="text-foreground-neutral-muted">Expires</dt>
                <dd>{formatRunnerTokenDate(token.expires_at)}</dd>
              </div>
              <div>
                <dt className="text-foreground-neutral-muted">Created</dt>
                <dd>{formatRunnerTokenDate(token.created_at)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function RevokeRunnerTokenButton({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: RunnerTokenDto;
}) {
  const queryClient = useQueryClient();
  const revokeToken = useRevokeRunnerTokenMutation();
  const [open, setOpen] = useState(false);
  const tokenName = runnerTokenDisplayName(token);

  async function handleRevoke() {
    try {
      await revokeToken.mutateAsync({workspaceId, tokenId: token.id});
      await queryClient.invalidateQueries({queryKey: runnerTokenQueryKeys.list(workspaceId)});
      setOpen(false);
    } catch {
      // React Query stores the error for the inline popover alert.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      revokeToken.reset();
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="transparentMuted"
          iconLeft="deleteBinLine"
          aria-label={`Revoke ${tokenName}`}
        >
          Revoke
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-280 p-14">
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-4">
            <Text size="sm" bold>
              Revoke token?
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted">
              {tokenName} will stop creating new runner sessions. Existing sessions and job leases
              expire on their own.
            </Text>
          </div>
          {revokeToken.isError ? (
            <Alert variant="error" animated={false}>
              <Text size="sm">{runnerTokenErrorMessage(revokeToken.error)}</Text>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-8">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              isLoading={revokeToken.isPending}
              onClick={handleRevoke}
            >
              Revoke
            </Button>
          </div>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}

export function EmptyRunnerTokens() {
  return (
    <EmptyState
      icon="key2Line"
      title="No usable runner tokens"
      description="Create a token to connect a runner to this workspace."
    />
  );
}

export function RunnerTokenTableSkeleton() {
  return (
    <div role="status" aria-label="Loading runner tokens" className="flex flex-col gap-8">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-44 w-full" />
      ))}
    </div>
  );
}
