import {type RefObject, useEffect} from 'react';

/**
 * Listens for `cmd+K` (mac) or `ctrl+K` (Linux/Windows) and clicks the
 * referenced trigger element to open the workspace switcher. Used by
 * `<MainLayout>` to wire the global shortcut.
 */
export function useCmdKShortcut(triggerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'k' && event.key !== 'K') return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      triggerRef.current?.click();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerRef]);
}
