import type {CreateRunnerTokenResponseDto} from '@shipfox/api-runners-dto';
import {
  Button,
  Code,
  InlineTips,
  InlineTipsContent,
  InlineTipsDescription,
  InlineTipsTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from '@shipfox/react-ui';
import {type FormEvent, useState} from 'react';

export const CREATE_RUNNER_TOKEN_FORM_ID = 'create-runner-token-form';

export type RunnerTokenExpirationOption = '3600' | '86400' | '604800' | 'never';

const expirationOptions: Array<{
  value: RunnerTokenExpirationOption;
  label: string;
}> = [
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
  name,
  expiration,
  onNameChange,
  onExpirationChange,
  onSubmit,
}: {
  name: string;
  expiration: RunnerTokenExpirationOption;
  onNameChange: (name: string) => void;
  onExpirationChange: (expiration: RunnerTokenExpirationOption) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-8">
      <form
        id={CREATE_RUNNER_TOKEN_FORM_ID}
        className="flex w-full items-end gap-16 max-[640px]:flex-col max-[640px]:items-stretch"
        onSubmit={onSubmit}
      >
        <div className="flex flex-1 flex-col gap-8">
          <Label htmlFor="runner-token-name">Token name</Label>
          <Input
            id="runner-token-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Local runner"
            maxLength={80}
            className="w-full"
          />
        </div>
        <div className="flex flex-1 flex-col gap-8">
          <Label htmlFor="runner-token-expiration">Expires</Label>
          <Select
            value={expiration}
            onValueChange={(value) => onExpirationChange(value as RunnerTokenExpirationOption)}
          >
            <SelectTrigger
              id="runner-token-expiration"
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
        </div>
      </form>
      <Text size="sm" className="text-foreground-neutral-muted">
        {expirationHint(expiration)}
      </Text>
    </div>
  );
}

export function CreatedRunnerTokenPanel({token}: {token: CreateRunnerTokenResponseDto}) {
  const [copied, setCopied] = useState(false);

  async function copy(value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </InlineTipsContent>
    </InlineTips>
  );
}
