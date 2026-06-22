export async function copyTextToClipboard(text: string) {
  if ('clipboard' in navigator) return await navigator.clipboard.writeText(text);
  return document.execCommand('copy', true, text);
}
