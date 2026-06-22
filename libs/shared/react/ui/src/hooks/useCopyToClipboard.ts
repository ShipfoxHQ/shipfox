'use client';

import {useState} from 'react';
import {copyTextToClipboard} from '#utils/clipboard.js';

interface UseCopyToClipboardParams {
  text: string;
  onCopy?: (text: string) => void;
}

export function useCopyToClipboard({text, onCopy}: UseCopyToClipboardParams) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyTextToClipboard(text);

    if (onCopy) onCopy(text);
    setCopied(true);
  };

  return {copy, copied};
}
