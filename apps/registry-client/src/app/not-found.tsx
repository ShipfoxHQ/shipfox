import {Header} from '@shipfox/react-ui/typography';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-group">
      <Header variant="h1" className="text-foreground-neutral-base">
        Package not found
      </Header>
      <p className="text-sm text-foreground-neutral-subtle">
        The registry has no package at this address.
      </p>
      <Link href="/" className="text-sm text-foreground-highlight-interactive underline">
        Browse the registry
      </Link>
    </div>
  );
}
