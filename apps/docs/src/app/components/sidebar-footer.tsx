export function SidebarFooter() {
  return (
    <div className="flex items-center gap-2 justify-center">
      <a
        href="https://dashboard.shipfox.io"
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fd-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-[#101010] text-[#FFFFFF] shadow hover:bg-[#101010]/90 h-9 px-4 py-2"
      >
        Shipfox Dashboard
      </a>
    </div>
  );
}
