const AMI_ID_PATTERN = /ami-[0-9a-f]+/gi;

export function findProducedAmiId(output: string): string | null {
  return [...output.matchAll(AMI_ID_PATTERN)].at(-1)?.[0] ?? null;
}
