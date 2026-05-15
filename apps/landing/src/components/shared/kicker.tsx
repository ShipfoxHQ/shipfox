import type {ReactNode} from 'react';

export function Kicker({children}: {children: ReactNode}) {
  return (
    <span className="font-code text-primary-400 text-[11px] font-medium uppercase leading-none tracking-[.08em]">
      {children}
    </span>
  );
}
