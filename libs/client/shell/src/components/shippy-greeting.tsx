import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Text} from '@shipfox/react-ui/typography';
import {useAtom} from 'jotai';
import {useCallback, useEffect, useId} from 'react';
import {persistedAtom} from '#runtime/persisted-atom.js';
import {useProjectDock} from '#runtime/project-dock.js';

const shippyGreetedKey = {
  key: 'shipfox.shippy.greeted',
  lifetime: 'persistent',
  principalScope: 'global',
  serialize: (greeted: boolean) => String(greeted),
  parse: (raw: string) => (raw === 'true' ? true : undefined),
} satisfies BrowserStorageKey<boolean>;

const shippyGreetedAtom = persistedAtom(
  createTypedBrowserStorage(localStorageOrUndefined, shippyGreetedKey),
  false,
);

/**
 * The first-run greeting, once per browser. Opening the panel by any route counts as meeting
 * Shippy, so a project that opens with the panel open never shows it.
 */
export function useShippyGreeting(): {pending: boolean; dismiss: () => void} {
  const {open} = useProjectDock();
  const [greeted, setGreeted] = useAtom(shippyGreetedAtom);
  useEffect(() => {
    if (open && !greeted) setGreeted(true);
  }, [open, greeted, setGreeted]);
  const dismiss = useCallback(() => setGreeted(true), [setGreeted]);
  return {pending: !greeted && !open, dismiss};
}

/** The only time Shippy speaks first. It takes no focus, because it must never interrupt. */
export function ShippyGreeting({
  onSayHello,
  onDismiss,
}: {
  onSayHello: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex w-320 flex-col gap-cluster rounded-10 bg-background-neutral-overlay p-panel-compact shadow-tooltip"
    >
      <div className="flex flex-col gap-tight">
        <Text id={titleId} size="sm" bold>
          Hi, I'm Shippy.
        </Text>
        <Text size="sm" className="text-foreground-neutral-subtle">
          I know this project's runs and workflows. Ask me why something failed, or ask me to build
          something.
        </Text>
      </div>
      <div className="flex gap-inline">
        <Button size="sm" onClick={onSayHello}>
          Say hello
        </Button>
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
