import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useFormField,
} from '@shipfox/react-ui';

export type TokenExpirationOption =
  | '86400'
  | '604800'
  | '2592000'
  | '7776000'
  | '15552000'
  | '31536000'
  | 'never';

export const expirationOptions: Array<{value: TokenExpirationOption; label: string}> = [
  {value: '86400', label: '1 day'},
  {value: '604800', label: '7 days'},
  {value: '2592000', label: '30 days'},
  {value: '7776000', label: '90 days'},
  {value: '15552000', label: '180 days'},
  {value: '31536000', label: '1 year'},
  {value: 'never', label: 'Never'},
];

export function expirationHint(expiration: TokenExpirationOption): string {
  if (expiration === 'never') return 'Token will not expire.';
  const expiresAt = new Date(Date.now() + Number(expiration) * 1000);
  const formatted = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(expiresAt);
  return `Expires on ${formatted}.`;
}

export function ExpirationSelect({
  value,
  onValueChange,
}: {
  value: TokenExpirationOption;
  onValueChange: (next: TokenExpirationOption) => void;
}) {
  const wiring = useFormField();
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as TokenExpirationOption)}>
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
