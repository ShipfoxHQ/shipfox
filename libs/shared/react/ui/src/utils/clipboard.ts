export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Insecure context or denied permission: fall through to the legacy path.
    }
  }

  // `execCommand('copy')` ignores any value argument and copies the current
  // selection, so the text must be selected first. Throw on failure so callers
  // never report a successful copy when the clipboard was not written.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command was rejected by the browser');
    }
  } finally {
    textarea.remove();
  }
}
