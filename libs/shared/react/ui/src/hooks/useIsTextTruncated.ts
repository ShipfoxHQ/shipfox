'use client';

import {useCallback, useEffect, useState} from 'react';

export function useIsTextTruncated<TElement extends HTMLElement>(text: string) {
  const [element, setElement] = useState<TElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const ref = useCallback((node: TElement | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) {
      setIsTruncated(false);
      return;
    }
    if (text.length === 0) {
      setIsTruncated(false);
      return;
    }

    const updateTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };
    updateTruncation();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateTruncation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);

  return {ref, isTruncated};
}
