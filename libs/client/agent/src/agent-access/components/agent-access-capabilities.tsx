const AGENT_ACCESS_CAPABILITIES = [
  'Read workspace data (runs, logs, events)',
  'Download step logs',
  'Run actions (cancel and rerun runs, fire manual triggers, start dev runs)',
] as const;

export function AgentAccessCapabilities() {
  return (
    <ul aria-label="Connected app capabilities" className="flex list-disc flex-col gap-tight">
      {AGENT_ACCESS_CAPABILITIES.map((capability) => (
        <li key={capability}>{capability}</li>
      ))}
    </ul>
  );
}
