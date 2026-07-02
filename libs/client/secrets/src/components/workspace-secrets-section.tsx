import type {SecretDto} from '@shipfox/api-secrets-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {
  Button,
  Code,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Header,
  IconButton,
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  RelativeTime,
  RelativeTimeProvider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useMemo, useState} from 'react';
import {useDeleteSecretMutation, useSecretsQuery} from '#hooks/api/secrets.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {SecretForm} from './secret-form.js';
import {StoreRowsSkeleton, StoreSurface} from './store-section-shell.js';

// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${{ secrets.NAME }} reference syntax is shown to users.
const SECRET_REFERENCE = '${{ secrets.NAME }}';

type FormState = {mode: 'create'} | {mode: 'edit'; key: string} | null;

export function WorkspaceSecretsSection({workspaceId}: {workspaceId: string}) {
  const secretsQuery = useSecretsQuery(workspaceId);
  const deleteSecret = useDeleteSecretMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const secrets = useMemo(
    () => [...(secretsQuery.data ?? [])].sort((a, b) => a.key.localeCompare(b.key)),
    [secretsQuery.data],
  );

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-16" aria-label="Secrets">
        <div className="flex items-start justify-between gap-16">
          <div className="flex flex-col gap-4">
            <Header variant="h3">Secrets</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Encrypted, write-only values. Reference them from workflows as{' '}
              <Code as="span" variant="label">
                {SECRET_REFERENCE}
              </Code>
              .
            </Text>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Add secret
          </Button>
        </div>

        {secretsQuery.isPending ? <StoreRowsSkeleton label="Loading secrets" /> : null}

        {secretsQuery.isError && secretsQuery.data === undefined ? (
          <StoreSurface className="px-16">
            <QueryLoadError query={secretsQuery} subject="secrets" />
          </StoreSurface>
        ) : null}

        {secretsQuery.data !== undefined && secrets.length === 0 ? (
          <StoreSurface className="px-16">
            <EmptyState
              icon="keyLine"
              title="No secrets yet"
              description={`Secrets are encrypted and write-only. Reference them from workflows as ${SECRET_REFERENCE}.`}
              action={
                <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
                  Add secret
                </Button>
              }
            />
          </StoreSurface>
        ) : null}

        {secrets.length > 0 ? (
          <StoreSurface>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Last edited</TableHead>
                  <TableHead className="w-40 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {secrets.map((secret) => (
                  <SecretRow
                    key={secret.key}
                    secret={secret}
                    onEdit={() => setFormState({mode: 'edit', key: secret.key})}
                    onDelete={() => setDeleteKey(secret.key)}
                  />
                ))}
              </TableBody>
            </Table>
          </StoreSurface>
        ) : null}
      </section>

      <Modal
        open={formState !== null}
        onOpenChange={(open) => {
          if (!open) setFormState(null);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{formState?.mode === 'edit' ? 'Update secret' : 'Add secret'}</ModalTitle>
          </ModalHeader>
          {formState ? (
            <SecretForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.key : undefined}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Secret updated' : 'Secret added');
              }}
              onCancel={() => setFormState(null)}
            />
          ) : null}
        </ModalContent>
      </Modal>

      <DeleteEntryDialog
        open={deleteKey !== null}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
        entryKey={deleteKey ?? ''}
        kind="secret"
        isLoading={deleteSecret.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteSecret.mutateAsync({workspaceId, key: deleteKey});
            toast.success('Secret deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

function SecretRow({
  secret,
  onEdit,
  onDelete,
}: {
  secret: SecretDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Code as="span" variant="paragraph">
          {secret.key}
        </Code>
      </TableCell>
      <TableCell>
        <span
          role="img"
          aria-label="Value hidden"
          className="font-code text-foreground-neutral-muted"
        >
          ••••••••
        </span>
      </TableCell>
      <TableCell className="text-foreground-neutral-muted">
        <RelativeTime value={secret.updated_at} />
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Actions for ${secret.key}`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon="fileCopyLine" onSelect={() => void copyKeyName(secret.key)}>
              Copy name
            </DropdownMenuItem>
            <DropdownMenuItem icon="editLine" onSelect={onEdit}>
              Edit value
            </DropdownMenuItem>
            <DropdownMenuItem icon="deleteBinLine" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
