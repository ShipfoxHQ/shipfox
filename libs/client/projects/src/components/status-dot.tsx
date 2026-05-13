/**
 * 8px status dot, the dense-row form factor for state (DESIGN.md §10).
 *
 * Variants map to the `--tag-*-text` token family, so the dot color matches
 * the status pill text it stands in for. When `pulse` is set, a `ping`
 * halo renders behind the dot — gated on `prefers-reduced-motion:
 * no-preference` so users who opt out see a static dot only.
 */

type StatusDotVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const bgByVariant: Record<StatusDotVariant, string> = {
  neutral: 'bg-tag-neutral-text',
  info: 'bg-tag-blue-text',
  success: 'bg-tag-success-text',
  warning: 'bg-tag-warning-text',
  error: 'bg-tag-error-text',
};

export function StatusDot({
  variant,
  pulse = false,
  className,
}: {
  variant: StatusDotVariant;
  pulse?: boolean;
  className?: string;
}) {
  const bg = bgByVariant[variant];
  return (
    <span
      className={`relative inline-flex size-8 shrink-0 items-center justify-center${
        className ? ` ${className}` : ''
      }`}
      aria-hidden="true"
    >
      {pulse ? (
        <span
          className={`absolute inline-flex size-8 rounded-full opacity-75 motion-safe:animate-ping ${bg}`}
        />
      ) : null}
      <span className={`relative inline-flex size-8 rounded-full ${bg}`} />
    </span>
  );
}

export type {StatusDotVariant};
