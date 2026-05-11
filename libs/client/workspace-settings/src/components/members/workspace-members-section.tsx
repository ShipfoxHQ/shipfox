import {createInvitationBodySchema, type MembershipWithUserDto} from '@shipfox/api-workspaces-dto';
import {ApiError} from '@shipfox/client-api';
import {useAuthState} from '@shipfox/client-auth';
import {
  Alert,
  Badge,
  Button,
  Code,
  Header,
  Icon,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from '@shipfox/react-ui';
import {type FormEvent, useState} from 'react';
import {useCreateInvitation} from '#hooks/api/create-invitation.js';
import {useListInvitations} from '#hooks/api/list-invitations.js';
import {useListMembers} from '#hooks/api/list-members.js';
import {useRemoveMember} from '#hooks/api/remove-member.js';
import {useRevokeInvitation} from '#hooks/api/revoke-invitation.js';

const EXPIRES_SOON_MS = 24 * 60 * 60 * 1000;

export function WorkspaceMembersSettingsSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-32">
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
  const members = query.data?.members ?? [];

  return (
    <section className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <Header variant="h3">Members</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          {query.isPending
            ? 'Loading members…'
            : `${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        </Text>
      </div>

      {query.isPending ? <TableSkeleton rows={3} cols={3} /> : null}

      {query.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load members
            </Text>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!query.isPending && !query.isError && members.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={member.user_id === auth.user?.id}
                workspaceId={workspaceId}
                workspaceName={workspaceName}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function MemberRow({
  member,
  isSelf,
  workspaceId,
  workspaceName,
}: {
  member: MembershipWithUserDto;
  isSelf: boolean;
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveMember(workspaceId);

  async function handleRemove() {
    try {
      await remove.mutateAsync(member.user_id);
      toast.success(`Removed ${member.user_email} from ${workspaceName}.`);
      setOpen(false);
    } catch (error) {
      toast.error(removeMemberErrorMessage(error));
    }
  }

  return (
    <TableRow className={remove.isPending ? 'opacity-60' : undefined}>
      <TableCell className="font-medium">{member.user_name ?? '—'}</TableCell>
      <TableCell>
        <Code variant="paragraph">{member.user_email}</Code>
      </TableCell>
      <TableCell>{formatDate(member.created_at)}</TableCell>
      <TableCell className="text-right">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button
              size="sm"
              variant="transparentMuted"
              aria-label="Remove member"
              disabled={isSelf}
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
                Remove {member.user_name ?? member.user_email} from {workspaceName}?
              </Text>
            </ModalHeader>
            <ModalBody>
              <Text size="sm">
                They will lose access immediately. They can be re-invited later.
              </Text>
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
      </TableCell>
    </TableRow>
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
  const invitations = query.data?.invitations ?? [];
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <section className="flex flex-col gap-16">
      <div className="flex items-center justify-between gap-16">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Pending invitations</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            {query.isPending
              ? 'Loading invitations…'
              : `${invitations.length} ${invitations.length === 1 ? 'invitation' : 'invitations'}`}
          </Text>
        </div>
        <InviteMemberModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
        />
      </div>

      {query.isPending ? <TableSkeleton rows={2} cols={3} /> : null}

      {query.isError ? (
        <Alert variant="error" animated={false}>
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load invitations
            </Text>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}

      {!query.isPending && !query.isError && invitations.length === 0 ? <EmptyInvitations /> : null}

      {!query.isError && invitations.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                workspaceId={workspaceId}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function InvitationRow({
  invitation,
  workspaceId,
}: {
  invitation: import('@shipfox/api-workspaces-dto').InvitationDto;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeInvitation(workspaceId);
  const expiresAt = new Date(invitation.expires_at);
  const expiresSoon = expiresAt.getTime() - Date.now() < EXPIRES_SOON_MS;

  async function handleRevoke() {
    try {
      await revoke.mutateAsync(invitation.id);
      toast.success(`Invitation to ${invitation.email} revoked.`);
      setOpen(false);
    } catch {
      toast.error('Could not revoke invitation.');
    }
  }

  return (
    <TableRow className={revoke.isPending ? 'opacity-60' : undefined}>
      <TableCell>
        <Code variant="paragraph">{invitation.email}</Code>
      </TableCell>
      <TableCell>{invitation.invited_by_display ?? '—'}</TableCell>
      <TableCell>
        <div className="flex items-center gap-8">
          <Text size="sm">{formatDate(invitation.expires_at)}</Text>
          {expiresSoon ? <Badge variant="warning">Soon</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
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
      </TableCell>
    </TableRow>
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
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | undefined>();
  const [conflict, setConflict] = useState<string | undefined>();
  const create = useCreateInvitation(workspaceId);

  function reset() {
    setEmail('');
    setFieldError(undefined);
    setServerError(undefined);
    setConflict(undefined);
    create.reset();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);
    setConflict(undefined);

    const parsed = createInvitationBodySchema.safeParse({email});
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === 'email');
      setFieldError(issue?.message ?? 'Enter a valid email address.');
      return;
    }
    setFieldError(undefined);

    try {
      const result = await create.mutateAsync(parsed.data);
      toast.success(`Invitation sent to ${result.email}.`);
      handleOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'open-invitation-exists') {
        setConflict('An open invitation already exists for this email.');
        return;
      }
      setServerError(error instanceof Error ? error.message : 'Could not send invitation.');
    }
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
        <ModalBody className="gap-16">
          {conflict ? <Alert variant="warning">{conflict}</Alert> : null}
          {serverError ? <Alert variant="error">{serverError}</Alert> : null}
          <form id="invite-member-form" className="flex flex-col gap-16" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-8">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                aria-invalid={fieldError ? true : undefined}
                autoComplete="email"
                autoFocus
                id="invite-email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
              {fieldError ? (
                <Text as="p" size="xs" className="text-tag-error-text">
                  {fieldError}
                </Text>
              ) : (
                <Text size="xs" className="text-foreground-neutral-muted">
                  They'll receive an email with a link to join {workspaceName}.
                </Text>
              )}
            </div>
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
    <div className="flex flex-col items-center gap-12 rounded-8 border border-border-neutral-base bg-background-subtle-base p-32 text-center">
      <Icon name="mailLine" className="size-24 text-foreground-neutral-muted" />
      <div className="flex flex-col gap-4">
        <Text size="sm" bold>
          No pending invitations.
        </Text>
        <Text size="sm" className="text-foreground-neutral-muted">
          Invite someone above to grow your workspace.
        </Text>
      </div>
    </div>
  );
}

function TableSkeleton({rows, cols}: {rows: number; cols: number}) {
  return (
    <div className="flex flex-col gap-12">
      {Array.from({length: rows}).map((_, rowIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable placeholder rows
        <div key={rowIdx} className="grid grid-cols-3 gap-16">
          {Array.from({length: cols}).map((__, colIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable placeholder cells
            <Skeleton key={colIdx} className="h-20" />
          ))}
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function removeMemberErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'self-removal-not-allowed') return "You can't remove yourself.";
    if (error.code === 'last-member') return 'Cannot remove the last member.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Could not remove member.';
}
