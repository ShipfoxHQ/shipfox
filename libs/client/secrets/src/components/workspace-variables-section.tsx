import type {VariableListItemDto} from '@shipfox/api-secrets-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import {RelativeTime, RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {useMemo, useState} from 'react';
import {useDeleteVariableMutation, useVariablesQuery} from '#hooks/api/variables.js';
import {copyKeyName} from './copy-key.js';
import {DeleteEntryDialog} from './delete-entry-dialog.js';
import {secretsErrorToFormError} from './form-errors.js';
import {StoreRowsSkeleton, StoreSurface} from './store-section-shell.js';
import {VariableForm} from './variable-form.js';

// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${{ vars.NAME }} reference syntax is shown to users.
const VARS_REFERENCE = '${{ vars.NAME }}';

type FormState = {mode: 'create'} | {mode: 'edit'; variable: VariableListItemDto} | null;

export function WorkspaceVariablesSection({workspaceId}: {workspaceId: string}) {
  const variablesQuery = useVariablesQuery(workspaceId);
  const deleteVariable = useDeleteVariableMutation();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const variables = useMemo(
    () => [...(variablesQuery.data ?? [])].sort((a, b) => a.key.localeCompare(b.key)),
    [variablesQuery.data],
  );

  function closeDelete() {
    setDeleteKey(null);
    setDeleteError(undefined);
  }

  return (
    <RelativeTimeProvider>
      <section className="flex flex-col gap-16" aria-label="Variables">
        <div className="flex items-start justify-between gap-16">
          <div className="flex flex-col gap-4">
            <Header variant="h3">Variables</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Plaintext config, not redacted from logs. Use a Secret for sensitive values. Reference
              them from workflows as{' '}
              <Code as="span" variant="label">
                {VARS_REFERENCE}
              </Code>
              .
            </Text>
          </div>
          <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
            Add variable
          </Button>
        </div>

        {variablesQuery.isPending ? <StoreRowsSkeleton label="Loading variables" /> : null}

        {variablesQuery.isError && variablesQuery.data === undefined ? (
          <StoreSurface className="px-16">
            <QueryLoadError query={variablesQuery} subject="variables" />
          </StoreSurface>
        ) : null}

        {variablesQuery.data !== undefined && variables.length === 0 ? (
          <StoreSurface className="px-16">
            <EmptyState
              icon="bracesLine"
              title="No variables yet"
              description={`Variables are plaintext config. Reference them from workflows as ${VARS_REFERENCE}.`}
              action={
                <Button size="sm" onClick={() => setFormState({mode: 'create'})}>
                  Add variable
                </Button>
              }
            />
          </StoreSurface>
        ) : null}

        {variables.length > 0 ? (
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
                {variables.map((variable) => (
                  <VariableRow
                    key={variable.key}
                    variable={variable}
                    onEdit={() => setFormState({mode: 'edit', variable})}
                    onDelete={() => setDeleteKey(variable.key)}
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
            <ModalTitle>
              {formState?.mode === 'edit' ? 'Update variable' : 'Add variable'}
            </ModalTitle>
          </ModalHeader>
          {formState ? (
            <VariableForm
              workspaceId={workspaceId}
              mode={formState.mode}
              existingKey={formState.mode === 'edit' ? formState.variable.key : undefined}
              existingValue={formState.mode === 'edit' ? formState.variable.value : undefined}
              existingValueTruncated={
                formState.mode === 'edit' ? formState.variable.value_truncated : undefined
              }
              reservedKeys={variables.map((variable) => variable.key)}
              onSaved={() => {
                const wasEdit = formState.mode === 'edit';
                setFormState(null);
                toast.success(wasEdit ? 'Variable updated' : 'Variable added');
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
        kind="variable"
        isLoading={deleteVariable.isPending}
        errorMessage={deleteError}
        onConfirm={async () => {
          if (deleteKey === null) return;
          setDeleteError(undefined);
          try {
            await deleteVariable.mutateAsync({workspaceId, key: deleteKey});
            toast.success('Variable deleted');
            closeDelete();
          } catch (error) {
            setDeleteError(secretsErrorToFormError(error).message);
          }
        }}
      />
    </RelativeTimeProvider>
  );
}

function VariableRow({
  variable,
  onEdit,
  onDelete,
}: {
  variable: VariableListItemDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Code as="span" variant="paragraph">
          {variable.key}
        </Code>
      </TableCell>
      <TableCell>
        <span
          title={variable.value}
          className="block max-w-[280px] truncate font-code text-foreground-neutral-base"
        >
          {variable.value === '' ? (
            <span className="text-foreground-neutral-muted">(empty)</span>
          ) : (
            variable.value
          )}
        </span>
      </TableCell>
      <TableCell className="text-foreground-neutral-muted">
        <RelativeTime value={variable.updated_at} />
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="transparent"
              icon="more2Line"
              aria-label={`Actions for ${variable.key}`}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon="fileCopyLine" onSelect={() => void copyKeyName(variable.key)}>
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
