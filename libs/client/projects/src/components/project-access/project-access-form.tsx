import {
  type IntegrationConnection,
  IntegrationIcon,
  PROVIDER_CATALOG,
} from '@shipfox/client-integrations';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Checkbox} from '@shipfox/react-ui/checkbox';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useId, useMemo, useReducer, useState} from 'react';
import type {Project} from '#core/project.js';
import {
  type AccessDraft,
  type AccessDraftAction,
  type AccessDraftConnection,
  type AccessResource,
  accessDraftFromAccess,
  findEmptyResourceScopes,
  isSameAccess,
  lockedConnectionId,
  type ProjectAccess,
  type ProjectAccessConfigSource,
  REPOSITORY_RESOURCE_KIND,
  reduceAccessDraft,
  toUpdateProjectAccessCommand,
} from '#core/project-access.js';
import {useUpdateProjectAccessMutation} from '#hooks/api/project-access.js';
import {projectAccessSaveError} from './access-form-errors.js';
import {accessChangeWarnings} from './access-warnings.js';
import {RepositoryScopePicker} from './repository-scope-picker.js';

export interface ProjectAccessFormProps {
  project: Project;
  access: ProjectAccess;
  /** The workspace's connections, which an admin can add to the project's access. */
  connections: IntegrationConnection[];
  readOnly?: boolean;
}

interface ConnectionEntry {
  connectionId: string;
  provider: string | null;
  displayName: string;
  supportsRepositories: boolean;
}

function providerName(provider: string): string {
  return PROVIDER_CATALOG[provider]?.displayName ?? provider;
}

/** The workspace's connections, then any listed connection the workspace no longer has. */
function connectionEntries(
  connections: readonly IntegrationConnection[],
  access: ProjectAccess,
): ConnectionEntry[] {
  const entries: ConnectionEntry[] = connections.map((connection) => ({
    connectionId: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    supportsRepositories: connection.capabilities.includes('source_control'),
  }));
  if (access.connections === 'all') return entries;
  const known = new Set(entries.map((entry) => entry.connectionId));
  for (const listed of access.connections) {
    if (known.has(listed.connectionId)) continue;
    entries.push({
      connectionId: listed.connectionId,
      provider: listed.provider,
      displayName: listed.displayName ?? 'Removed connection',
      supportsRepositories: false,
    });
  }
  return entries;
}

export function ProjectAccessForm({
  project,
  access,
  connections,
  readOnly: readOnlyProp = false,
}: ProjectAccessFormProps) {
  const {configSource} = access;
  const saved = useMemo(() => accessDraftFromAccess(access), [access]);
  const [draft, dispatch] = useReducer(
    (current: AccessDraft, action: AccessDraftAction) =>
      reduceAccessDraft(current, action, configSource),
    saved,
  );
  const updateAccess = useUpdateProjectAccessMutation();
  const [submitted, setSubmitted] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [pendingWarnings, setPendingWarnings] = useState<string[] | null>(null);
  const readOnly = readOnlyProp || forbidden;
  const modeLabelId = useId();

  const entries = connectionEntries(connections, access);
  const emptyScopes = new Set(submitted ? findEmptyResourceScopes(draft, configSource) : []);
  const isDirty = !isSameAccess(saved, draft);

  async function save() {
    setFormError(undefined);
    try {
      await updateAccess.mutateAsync(toUpdateProjectAccessCommand(project.id, draft));
      setPendingWarnings(null);
      toast.success('Access saved.');
    } catch (error) {
      setPendingWarnings(null);
      const mapped = projectAccessSaveError(error);
      if (mapped.kind === 'forbidden') setForbidden(true);
      else setFormError(mapped.message);
    }
  }

  function submit() {
    setSubmitted(true);
    if (findEmptyResourceScopes(draft, configSource).length > 0) return;
    const warnings = accessChangeWarnings({
      projectId: project.id,
      isDefaultProject: project.isDefault,
      configSource,
      saved,
      draft,
      connections,
      providerName,
    });
    if (warnings.length > 0) {
      setPendingWarnings(warnings);
      return;
    }
    void save();
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-section">
        <Header variant="h1">Access</Header>

        <Panel>
          <PanelBody className="gap-group p-panel">
            <Text size="sm" className="text-foreground-neutral-muted">
              Access limits what this project&apos;s workflows and agents can use. It doesn&apos;t
              limit which members can see the project.
            </Text>
            {readOnly ? (
              <Callout type="info">
                Only workspace admins can change this project&apos;s access.
              </Callout>
            ) : null}
            <span id={modeLabelId} className="sr-only">
              Connections this project can use
            </span>
            <RadioGroup
              variant="cell"
              aria-labelledby={modeLabelId}
              value={draft.mode}
              disabled={readOnly || updateAccess.isPending}
              onValueChange={(value) => {
                if (value === 'all' || value === 'selected') {
                  dispatch({type: 'set-mode', mode: value});
                }
              }}
            >
              <RadioGroupItem value="all">
                <Text as="span" size="sm" bold>
                  All connections
                </Text>
                <Text as="span" size="xs" className="text-foreground-neutral-muted">
                  Every connection in the workspace, including connections added later.
                </Text>
              </RadioGroupItem>
              <RadioGroupItem value="selected">
                <Text as="span" size="sm" bold>
                  Only these connections
                </Text>
                <Text as="span" size="xs" className="text-foreground-neutral-muted">
                  Only the connections you check. Connections added later aren&apos;t included.
                </Text>
              </RadioGroupItem>
            </RadioGroup>
          </PanelBody>
        </Panel>

        {draft.mode === 'selected' ? (
          <Panel>
            <PanelHeader>
              <PanelTitle>Connections</PanelTitle>
            </PanelHeader>
            <PanelBody asChild>
              <ul aria-label="Connections">
                {entries.length === 0 ? (
                  <li className="px-row py-row">
                    <Text size="sm" className="text-foreground-neutral-muted">
                      This workspace has no connections yet.
                    </Text>
                  </li>
                ) : (
                  entries.map((entry) => (
                    <ConnectionRow
                      key={entry.connectionId}
                      entry={entry}
                      configSource={configSource}
                      listed={draft.connections.find(
                        (connection) => connection.connectionId === entry.connectionId,
                      )}
                      emptyScope={emptyScopes.has(entry.connectionId)}
                      disabled={readOnly || updateAccess.isPending}
                      dispatch={dispatch}
                    />
                  ))
                )}
              </ul>
            </PanelBody>
          </Panel>
        ) : null}

        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}

        {readOnly ? null : (
          <Button
            type="button"
            className="self-start"
            isLoading={updateAccess.isPending}
            disabled={!isDirty}
            onClick={submit}
          >
            Save changes
          </Button>
        )}
      </div>

      <AccessChangeWarning
        warnings={pendingWarnings}
        isSaving={updateAccess.isPending}
        onCancel={() => setPendingWarnings(null)}
        onConfirm={() => {
          void save();
        }}
      />
    </>
  );
}

function configRepositoryOf(configSource: ProjectAccessConfigSource): AccessResource {
  const name = configSource.lookupName ?? configSource.externalRepositoryId;
  return {
    kind: REPOSITORY_RESOURCE_KIND,
    externalId: configSource.externalRepositoryId,
    lookupName: name,
    displayName: name,
  };
}

function ConnectionRow({
  entry,
  configSource,
  listed,
  emptyScope,
  disabled,
  dispatch,
}: {
  entry: ConnectionEntry;
  configSource: ProjectAccessConfigSource;
  listed: AccessDraftConnection | undefined;
  emptyScope: boolean;
  disabled: boolean;
  dispatch: (action: AccessDraftAction) => void;
}) {
  const checkboxId = useId();
  const locked = entry.connectionId === lockedConnectionId(configSource);
  const configRepository = locked ? configRepositoryOf(configSource) : null;
  const resources = listed?.resources;
  const selectedResources = resources && resources !== 'all' ? resources : [];
  const showScope = listed !== undefined && entry.supportsRepositories;
  const name = entry.provider
    ? `${providerName(entry.provider)}, ${entry.displayName}`
    : entry.displayName;

  return (
    <PanelRow
      asChild
      className="flex-col items-stretch gap-cluster hover:bg-background-neutral-base"
    >
      <li>
        <div className="flex min-w-0 flex-wrap items-center gap-cluster">
          <Checkbox
            id={checkboxId}
            checked={listed !== undefined}
            disabled={disabled || locked}
            onCheckedChange={(next) =>
              dispatch({
                type: 'set-connection',
                connectionId: entry.connectionId,
                listed: next === true,
              })
            }
          />
          <label htmlFor={checkboxId} className="flex min-w-0 items-center gap-inline">
            {entry.provider ? (
              <IntegrationIcon
                source={entry.provider}
                aria-hidden
                className="size-20 shrink-0 text-foreground-neutral-base"
              />
            ) : null}
            <Text as="span" size="sm" bold className="truncate">
              {name}
            </Text>
          </label>
          {locked ? (
            <Text as="span" size="xs" className="shrink-0 text-foreground-neutral-muted">
              Config source
            </Text>
          ) : null}
          {showScope ? (
            <ResourceScopeSelect
              connectionName={name}
              scope={resources === 'all' ? 'all' : 'selected'}
              selectedCount={selectedResources.length + (configRepository ? 1 : 0)}
              disabled={disabled}
              onChange={(scope) =>
                dispatch({type: 'set-resource-scope', connectionId: entry.connectionId, scope})
              }
            />
          ) : null}
        </div>

        {showScope && resources !== 'all' ? (
          <SelectedRepositories
            connectionId={entry.connectionId}
            connectionName={name}
            configRepository={configRepository}
            resources={selectedResources}
            emptyScope={emptyScope}
            disabled={disabled}
            dispatch={dispatch}
          />
        ) : null}
      </li>
    </PanelRow>
  );
}

function ResourceScopeSelect({
  connectionName,
  scope,
  selectedCount,
  disabled,
  onChange,
}: {
  connectionName: string;
  scope: 'all' | 'selected';
  selectedCount: number;
  disabled: boolean;
  onChange: (scope: 'all' | 'selected') => void;
}) {
  return (
    <Select
      value={scope}
      disabled={disabled}
      onValueChange={(value) => {
        if (value === 'all' || value === 'selected') onChange(value);
      }}
    >
      <SelectTrigger
        size="small"
        aria-label={`Repositories on ${connectionName}`}
        className="ms-auto w-[200px]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All repositories</SelectItem>
        <SelectItem value="selected">{`Selected (${selectedCount})`}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SelectedRepositories({
  connectionId,
  connectionName,
  configRepository,
  resources,
  emptyScope,
  disabled,
  dispatch,
}: {
  connectionId: string;
  connectionName: string;
  configRepository: AccessResource | null;
  resources: AccessResource[];
  emptyScope: boolean;
  disabled: boolean;
  dispatch: (action: AccessDraftAction) => void;
}) {
  const errorId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const setResource = (resource: AccessResource, listed: boolean) =>
    dispatch({type: 'set-resource', connectionId, resource, listed});

  return (
    <div className="flex flex-col gap-inline ps-row">
      <ul
        aria-label={`Selected repositories on ${connectionName}`}
        className="flex flex-col gap-tight"
      >
        {configRepository ? (
          <li className="flex items-center gap-inline">
            <Text size="sm">{configRepository.displayName}</Text>
            <Text as="span" size="xs" className="text-foreground-neutral-muted">
              Config repository
            </Text>
          </li>
        ) : null}
        {resources.map((resource) => (
          <li key={resource.externalId} className="flex items-center gap-inline">
            <Text size="sm">{resource.displayName}</Text>
            {disabled ? null : (
              <Button
                type="button"
                variant="transparentMuted"
                size="2xs"
                aria-label={`Remove ${resource.displayName}`}
                onClick={() => setResource(resource, false)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {emptyScope ? (
        <Text id={errorId} size="xs" role="alert" className="text-foreground-highlight-error">
          Select at least one repository.
        </Text>
      ) : null}
      {disabled ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          aria-describedby={emptyScope ? errorId : undefined}
          onClick={() => setPickerOpen(true)}
        >
          Select repositories
        </Button>
      )}
      <RepositoryScopePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        connectionId={connectionId}
        connectionName={connectionName}
        selected={resources}
        lockedExternalId={configRepository?.externalId}
        onToggle={setResource}
      />
    </div>
  );
}

function AccessChangeWarning({
  warnings,
  isSaving,
  onCancel,
  onConfirm,
}: {
  warnings: string[] | null;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={warnings !== null}
      onOpenChange={(open) => {
        if (!open && !isSaving) onCancel();
      }}
    >
      <ModalContent aria-describedby={undefined}>
        <ModalHeader>
          <ModalTitle>Save access?</ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-group">
          <ul className="flex flex-col gap-inline">
            {(warnings ?? []).map((warning) => (
              <li key={warning}>
                <Text size="sm">{warning}</Text>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} isLoading={isSaving}>
            Save access
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
