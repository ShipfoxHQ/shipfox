'use client';

import {copyTextToClipboard} from '#utils/clipboard.js';

interface UseCopyToClipboardParams {
  text: string;
  onCopy?: (text: string) => void;
}

export function useCopyToClipboard({text, onCopy}: UseCopyToClipboardParams) {
  const copy = async () => {
    await copyTextToClipboard(text);
    onCopy?.(text);
  };

  return {copy};
}
