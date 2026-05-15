export function Banner() {
  return (
    <div className="border-alpha-white-6 border-b bg-[rgba(255,75,0,.05)]">
      <div className="wrap flex min-h-36 flex-wrap items-center justify-center gap-x-8 gap-y-4 py-6 text-sm leading-[20px]">
        <span className="text-foreground-neutral-subtle hidden sm:inline">
          Using Shipfox CI Runners?
        </span>
        <a
          href="https://docs.shipfox.io/"
          target="_blank"
          rel="noopener"
          className="text-primary-400 hover:text-primary-300 inline-flex items-center font-medium no-underline transition-colors"
        >
          <span className="sm:hidden">CI Runners docs ↗</span>
          <span className="hidden sm:inline">View docs at docs.shipfox.io ↗</span>
        </a>
      </div>
    </div>
  );
}
