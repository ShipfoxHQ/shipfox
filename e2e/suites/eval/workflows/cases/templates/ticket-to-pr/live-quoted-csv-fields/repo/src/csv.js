/** Parses CSV text into an array of rows, each an array of fields. */
export function parseCsv(text) {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(','));
}
