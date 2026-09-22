// Renders a short generated phrase whose code spans use Markdown backticks.
export function InlineCodeList({markdown}: {markdown: string}) {
  return (
    <>
      {markdown.split('`').map((part, index) =>
        index % 2 === 1 ? (
          <code className="font-mono text-fd-foreground" key={index}>
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
