import type {CreateRunnerTokenResponseDto} from '@shipfox/api-runners-dto';
import {
  Alert,
  Button,
  Code,
  FormField,
  FormFieldInput,
  InlineTips,
  InlineTipsContent,
  InlineTipsDescription,
  InlineTipsTitle,
  ModalBody,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  useFormField,
} from '@shipfox/react-ui';
import {useForm} from '@tanstack/react-form';
import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {runnerTokenQueryKeys, useCreateRunnerTokenMutation} from '#hooks/api/runner-tokens.js';
import {runnerTokenCreateErrorToFormError} from './form-errors.js';

export const CREATE_RUNNER_TOKEN_FORM_ID = 'create-runner-token-form';

export type RunnerTokenExpirationOption = '3600' | '86400' | '604800' | 'never';

const expirationOptions: Array<{value: RunnerTokenExpirationOption; label: string}> = [
  {value: '3600', label: '1 hour'},
  {value: '86400', label: '1 day'},
  {value: '604800', label: '7 days'},
  {value: 'never', label: 'Never'},
];

function expirationHint(expiration: RunnerTokenExpirationOption): string {
  if (expiration === 'never') return 'Token will not expire.';
  const expiresAt = new Date(Date.now() + Number(expiration) * 1000);
  const formatted = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(expiresAt);
  return `Expires on ${formatted}.`;
}

export function CreateRunnerTokenForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (token: CreateRunnerTokenResponseDto) => void;
}) {
  const queryClient = useQueryClient();
  const createToken = useCreateRunnerTokenMutation();
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {name: '', expiration: '86400' as RunnerTokenExpirationOption},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const trimmedName = value.name.trim();
      const body = {
        ...(trimmedName ? {name: trimmedName} : {}),
        ...(value.expiration === 'never' ? {} : {ttl_seconds: Number(value.expiration)}),
      };

      try {
        const token = await createToken.mutateAsync({workspaceId, body});
        await queryClient.invalidateQueries({queryKey: runnerTokenQueryKeys.list(workspaceId)});
        onCreated(token);
      } catch (error) {
        const mapped = runnerTokenCreateErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-16">
        <form
          id={CREATE_RUNNER_TOKEN_FORM_ID}
          className="flex w-full flex-col gap-8"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="flex w-full items-end gap-16 max-[640px]:flex-col max-[640px]:items-stretch">
            <form.Field
              name="name"
              validators={{
                onBlur: ({value}) =>
                  value.length <= 80 ? undefined : 'Token name must be 80 characters or fewer.',
              }}
            >
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Token name"
                  id="runner-token-name"
                  error={fieldError(field)}
                >
                  <FormFieldInput
                    placeholder="Local runner"
                    maxLength={80}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="expiration">
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Expires"
                  id="runner-token-expiration"
                  error={fieldError(field)}
                >
                  <ExpirationSelect
                    value={field.state.value}
                    onValueChange={(next) => field.handleChange(next)}
                  />
                </FormField>
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(state) => state.values.expiration}>
            {(expiration) => (
              <Text size="sm" className="text-foreground-neutral-muted">
                {expirationHint(expiration)}
              </Text>
            )}
          </form.Subscribe>
        </form>
        {formError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not create token
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Alert>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button type="submit" form={CREATE_RUNNER_TOKEN_FORM_ID} isLoading={createToken.isPending}>
          Create token
        </Button>
      </ModalFooter>
    </>
  );
}

function ExpirationSelect({
  value,
  onValueChange,
}: {
  value: RunnerTokenExpirationOption;
  onValueChange: (next: RunnerTokenExpirationOption) => void;
}) {
  const wiring = useFormField();
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as RunnerTokenExpirationOption)}
    >
      <SelectTrigger
        id={wiring.id}
        aria-invalid={wiring['aria-invalid']}
        aria-describedby={wiring['aria-describedby']}
        aria-label="Token expiration"
        className="w-full"
      >
        <SelectValue placeholder="Select expiration" />
      </SelectTrigger>
      <SelectContent>
        {expirationOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CreatedRunnerTokenPanel({token}: {token: CreateRunnerTokenResponseDto}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(value: string) {
    if (!navigator.clipboard) {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  return (
    <InlineTips type="success" variant="secondary" className="items-start">
      <InlineTipsContent className="flex flex-col gap-12">
        <div className="flex flex-col gap-2">
          <InlineTipsTitle className="mb-0">Token created</InlineTipsTitle>
          <InlineTipsDescription>Copy it now. It will not be shown again.</InlineTipsDescription>
        </div>
        <div className="flex items-center gap-8 max-[640px]:flex-col max-[640px]:items-stretch">
          <Code variant="paragraph" className="min-w-0 flex-1 break-all">
            {token.raw_token}
          </Code>
          <Button
            size="sm"
            variant="secondary"
            iconLeft="fileCopyLine"
            onClick={() => copy(token.raw_token)}
          >
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {copyState === 'failed' ? (
          <Text size="sm" className="text-foreground-neutral-muted">
            Copy failed: select and copy manually.
          </Text>
        ) : null}
      </InlineTipsContent>
    </InlineTips>
  );
}

interface FieldLike {
  state: {meta: {errors: Array<unknown>; isBlurred: boolean}};
}

function fieldError(field: FieldLike): string | undefined {
  if (!field.state.meta.isBlurred && field.state.meta.errors.length === 0) return undefined;
  const first = field.state.meta.errors[0];
  if (!first) return undefined;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String((first as {message: unknown}).message);
  }
  return undefined;
}
