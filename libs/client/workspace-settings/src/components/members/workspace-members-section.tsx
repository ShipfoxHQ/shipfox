import {createInvitationBodySchema} from '@shipfox/api-workspaces-dto';
import {useAuthState} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableSortableHeader, DataTableToolbar} from '@shipfox/react-ui/data-table';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {SearchInline} from '@shipfox/react-ui/search';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {formatDate} from '@shipfox/react-ui/utils';
import {useForm} from '@tanstack/react-form';
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {type ReactNode, useMemo, useState} from 'react';
import {
  getInvitationExpiry,
  getMemberRemovalRestriction,
  type PendingInvitation,
  type WorkspaceMember,
} from '#core/membership.js';
import {useCreateInvitation} from '#hooks/api/create-invitation.js';
import {useListInvitations} from '#hooks/api/list-invitations.js';
import {useListMembers} from '#hooks/api/list-members.js';
import {useRemoveMember} from '#hooks/api/remove-member.js';
import {useRevokeInvitation} from '#hooks/api/revoke-invitation.js';
import {invitationErrorToFormError, memberRemovalErrorMessage} from './form-errors.js';

const membersTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const memberColumnHelper = createColumnHelper<typeof membersTableFeatures, WorkspaceMember>();

const invitationsTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});
const invitationColumnHelper = createColumnHelper<
  typeof invitationsTableFeatures,
  PendingInvitation
>();

export function WorkspaceMembersSettingsSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-region">
      <MembersSection workspaceId={workspaceId} workspaceName={workspaceName} />
      <PendingInvitationsSection workspaceId={workspaceId} workspaceName={workspaceName} />
    </div>
  );
}

function MembersSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const auth = useAuthState();
  const query = useListMembers(workspaceId);
  const members = query.data ?? [];
  const [search, setSearch] = useState('');
  const columns = useMemo(
    () =>
      memberColumnHelper.columns([
        memberColumnHelper.accessor((member) => member.name ?? '', {
          id: 'name',
          header: ({column}) => <DataTableSortableHeader column={column} label="Name" />,
          cell: ({row}) => row.original.name ?? 'N/A',
        }),
        memberColumnHelper.accessor('email', {
          header: ({column}) => <DataTableSortableHeader column={column} label="Email" />,
          cell: ({getValue}) => <Code variant="paragraph">{getValue()}</Code>,
        }),
        memberColumnHelper.accessor('joinedAt', {
          header: ({column}) => <DataTableSortableHeader column={column} label="Joined" />,
          cell: ({getValue}) => formatDate(getValue()),
        }),
        memberColumnHelper.display({
          id: 'actions',
          enableSorting: false,
          header: () => <span className="sr-only">Actions</span>,
          cell: ({row}) => (
            <MemberActions
              member={row.original}
              members={members}
              currentUserId={auth.user?.id}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
            />
          ),
        }),
      ]),
    [auth.user?.id, members, workspaceId, workspaceName],
  );
  const table = useTable({
    columns,
    data: members,
    enableMultiSort: false,
    features: membersTableFeatures,
    getColumnCanGlobalFilter: (column) => column.id === 'name' || column.id === 'email',
    getRowId: (member) => member.id,
    globalFilterFn: filterFn_includesString,
    onGlobalFilterChange: (updater) =>
      setSearch(
        (current) => (typeof updater === 'function' ? updater(current) : updater) as string,
      ),
    state: {globalFilter: search},
    sortDescFirst: false,
  });
  const isFiltered = search.length > 0;
  const emptyContent = getMembersEmptyContent({
    isFiltered,
    onClear: () => setSearch(''),
    query,
  });

  return (
    <section className="flex flex-col gap-group">
      <div className="flex flex-col gap-tight">
        <Header variant="h1">Members</Header>
      </div>

      <DataTable
        table={table}
        aria-label="Workspace members"
        emptyContent={emptyContent}
        getRowProps={() => ({className: 'group/row'})}
        isLoading={query.isPending}
        loadingLabel="Loading members"
        loadingRowCount={3}
        minimumWidth={560}
        navigation={{kind: 'complete', count: table.getRowModel().rows.length}}
        toolbar={
          <DataTableToolbar
            {...(isFiltered
              ? {
                  clearFiltersAction: (
                    <Button
                      type="button"
                      size="2xs"
                      variant="transparentMuted"
                      onClick={() => setSearch('')}
                    >
                      Clear search
                    </Button>
                  ),
                }
              : {})}
            {...(query.isPending ? {} : {resultCount: table.getRowModel().rows.length})}
          >
            <SearchInline
              aria-label="Search members"
              placeholder="Search members"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </DataTableToolbar>
        }
      />
    </section>
  );
}

function getMembersEmptyContent({
  isFiltered,
  onClear,
  query,
}: {
  isFiltered: boolean;
  onClear: () => void;
  query: ReturnType<typeof useListMembers>;
}): ReactNode {
  if (query.isError && query.data === undefined) {
    return <QueryLoadError query={query} subject="members" variant="panel" />;
  }
  if (isFiltered) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching members"
        description="No members match your search."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
            Clear search
          </Button>
        }
        variant="panel"
      />
    );
  }

  return (
    <EmptyState
      icon="groupLine"
      title="No members yet"
      description="Invite someone to give them access to this workspace."
      variant="panel"
    />
  );
}

function MemberActions({
  member,
  members,
  currentUserId,
  workspaceId,
  workspaceName,
}: {
  member: WorkspaceMember;
  members: readonly WorkspaceMember[];
  currentUserId: string | undefined;
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveMember(workspaceId);
  const restriction = getMemberRemovalRestriction({member, members, currentUserId});

  async function handleRemove() {
    try {
      await remove.mutateAsync({userId: member.userId});
      toast.success(`Removed ${member.email} from ${workspaceName}.`);
      setOpen(false);
    } catch (error) {
      toast.error(memberRemovalErrorMessage(error));
    }
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button
          size="sm"
          variant="transparentMuted"
          aria-label="Remove member"
          disabled={restriction !== undefined}
          isLoading={remove.isPending}
          className={
            remove.isPending
              ? 'opacity-100 transition-opacity'
              : 'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100'
          }
        >
          <Icon name="userUnfollowLine" className="size-16" />
        </Button>
      </ModalTrigger>
      <ModalContent>
        <ModalTitle className="sr-only">Remove member</ModalTitle>
        <ModalHeader>
          <Text size="lg">
            Remove {member.name ?? member.email} from {workspaceName}?
          </Text>
        </ModalHeader>
        <ModalBody>
          <Text size="sm">They will lose access immediately. They can be re-invited later.</Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemove} isLoading={remove.isPending}>
            Remove
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function PendingInvitationsSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const query = useListInvitations(workspaceId);
  const invitations = query.data ?? [];
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const columns = useMemo(
    () =>
      invitationColumnHelper.columns([
        invitationColumnHelper.accessor('email', {
          header: ({column}) => <DataTableSortableHeader column={column} label="Email" />,
          cell: ({getValue}) => <Code variant="paragraph">{getValue()}</Code>,
        }),
        invitationColumnHelper.accessor((invitation) => invitation.invitedByDisplay ?? '', {
          id: 'invitedBy',
          header: ({column}) => <DataTableSortableHeader column={column} label="Invited by" />,
          cell: ({row}) => row.original.invitedByDisplay ?? 'N/A',
        }),
        invitationColumnHelper.accessor('expiresAt', {
          header: ({column}) => <DataTableSortableHeader column={column} label="Expires" />,
          cell: ({row}) => {
            const expiry = getInvitationExpiry(row.original);
            return (
              <div className="flex items-center gap-inline">
                <Text size="sm">{formatDate(row.original.expiresAt)}</Text>
                {expiry === 'expires-soon' ? <Badge variant="warning">Soon</Badge> : null}
                {expiry === 'expired' ? <Badge variant="error">Expired</Badge> : null}
              </div>
            );
          },
        }),
        invitationColumnHelper.display({
          id: 'actions',
          enableSorting: false,
          header: () => <span className="sr-only">Actions</span>,
          cell: ({row}) => (
            <InvitationActions invitation={row.original} workspaceId={workspaceId} />
          ),
        }),
      ]),
    [workspaceId],
  );
  const table = useTable({
    columns,
    data: invitations,
    enableMultiSort: false,
    features: invitationsTableFeatures,
    getColumnCanGlobalFilter: (column) => column.id === 'email' || column.id === 'invitedBy',
    getRowId: (invitation) => invitation.id,
    globalFilterFn: filterFn_includesString,
    onGlobalFilterChange: (updater) =>
      setSearch(
        (current) => (typeof updater === 'function' ? updater(current) : updater) as string,
      ),
    state: {globalFilter: search},
    sortDescFirst: false,
  });
  const isFiltered = search.length > 0;
  const emptyContent = getInvitationsEmptyContent({
    isFiltered,
    onClear: () => setSearch(''),
    query,
  });

  return (
    <section className="flex flex-col gap-group">
      <div className="flex items-center justify-between gap-group">
        <div className="flex flex-col gap-tight">
          <Header variant="h3">Pending invitations</Header>
        </div>
        <InviteMemberModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
        />
      </div>

      <DataTable
        table={table}
        aria-label="Pending invitations"
        emptyContent={emptyContent}
        getRowProps={() => ({className: 'group/row'})}
        isLoading={query.isPending}
        loadingLabel="Loading invitations"
        loadingRowCount={2}
        minimumWidth={560}
        navigation={{kind: 'complete', count: table.getRowModel().rows.length}}
        toolbar={
          <DataTableToolbar
            {...(isFiltered
              ? {
                  clearFiltersAction: (
                    <Button
                      type="button"
                      size="2xs"
                      variant="transparentMuted"
                      onClick={() => setSearch('')}
                    >
                      Clear search
                    </Button>
                  ),
                }
              : {})}
            {...(query.isPending ? {} : {resultCount: table.getRowModel().rows.length})}
          >
            <SearchInline
              aria-label="Search pending invitations"
              placeholder="Search invitations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </DataTableToolbar>
        }
      />
    </section>
  );
}

function getInvitationsEmptyContent({
  isFiltered,
  onClear,
  query,
}: {
  isFiltered: boolean;
  onClear: () => void;
  query: ReturnType<typeof useListInvitations>;
}): ReactNode {
  if (query.isError && query.data === undefined) {
    return <QueryLoadError query={query} subject="invitations" variant="panel" />;
  }
  if (isFiltered) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching invitations"
        description="No pending invitations match your search."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
            Clear search
          </Button>
        }
        variant="panel"
      />
    );
  }

  return <EmptyInvitations />;
}

function InvitationActions({
  invitation,
  workspaceId,
}: {
  invitation: PendingInvitation;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeInvitation(workspaceId);

  async function handleRevoke() {
    try {
      await revoke.mutateAsync({invitationId: invitation.id});
      toast.success(`Invitation to ${invitation.email} revoked.`);
      setOpen(false);
    } catch {
      toast.error('Could not revoke invitation.');
    }
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button
          size="sm"
          variant="transparentMuted"
          aria-label="Revoke invitation"
          isLoading={revoke.isPending}
          className={
            revoke.isPending
              ? 'opacity-100 transition-opacity'
              : 'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100'
          }
        >
          <Icon name="closeLine" className="size-16" />
        </Button>
      </ModalTrigger>
      <ModalContent>
        <ModalTitle className="sr-only">Revoke invitation</ModalTitle>
        <ModalHeader>
          <Text size="lg">Revoke invitation to {invitation.email}?</Text>
        </ModalHeader>
        <ModalBody>
          <Text size="sm">They will no longer be able to use the link from their email.</Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRevoke} isLoading={revoke.isPending}>
            Revoke
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function InviteMemberModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId: string;
  workspaceName: string;
}) {
  const create = useCreateInvitation(workspaceId);
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {email: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const result = await create.mutateAsync({email: value.email});
        toast.success(`Invitation sent to ${result.email}.`);
        // Go through handleOpenChange so form.reset() fires and reopening the
        // modal does not show stale form state.
        handleOpenChange(false);
      } catch (error) {
        const mapped = invitationErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      form.reset();
      setFormError(undefined);
      create.reset();
    }
    onOpenChange(nextOpen);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>
        <Button size="sm" variant="secondary">
          Invite member
        </Button>
      </ModalTrigger>
      <ModalContent>
        <ModalTitle className="sr-only">Invite a member</ModalTitle>
        <ModalHeader>
          <Text size="lg">Invite a member</Text>
        </ModalHeader>
        <ModalBody className="gap-group">
          {formError ? (
            <Callout role="alert" type="error">
              {formError}
            </Callout>
          ) : null}
          <form
            id="invite-member-form"
            className="flex flex-col gap-group"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="email"
              validators={{
                onBlur: createInvitationBodySchema.shape.email,
                onSubmit: createInvitationBodySchema.shape.email,
              }}
            >
              {(field) => (
                <FormField
                  label="Email"
                  id="invite-email"
                  error={fieldError(field)}
                  description={`They'll receive an email with a link to join ${workspaceName}.`}
                >
                  <FormFieldInput
                    autoComplete="email"
                    autoFocus
                    name="email"
                    type="email"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
          </form>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-member-form" isLoading={create.isPending}>
            Send invitation
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function EmptyInvitations() {
  return (
    <EmptyState
      icon="mailLine"
      title="No pending invitations."
      description="Invite someone above to grow your workspace."
      variant="panel"
    />
  );
}
