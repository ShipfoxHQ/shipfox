import {BadgeCheck} from 'lucide-react';

export function Publisher({displayName, verified}: {displayName: string; verified: boolean}) {
  return (
    <span className="inline-flex items-center gap-tight">
      {displayName}
      {verified ? (
        <BadgeCheck
          role="img"
          aria-label="Verified publisher"
          className="size-14 text-foreground-neutral-subtle"
        />
      ) : null}
    </span>
  );
}
