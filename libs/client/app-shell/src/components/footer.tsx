export function Footer() {
  return (
    <footer className="border-t border-border-neutral-base h-40 px-16 flex items-center justify-between text-xs text-foreground-neutral-muted shrink-0">
      <div className="flex items-center gap-16">
        <a
          href="https://docs.shipfox.io"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-foreground-neutral-base transition-colors"
        >
          Docs
        </a>
        <a
          href="mailto:support@shipfox.io"
          className="hover:text-foreground-neutral-base transition-colors"
        >
          Support
        </a>
      </div>
      <div />
    </footer>
  );
}
