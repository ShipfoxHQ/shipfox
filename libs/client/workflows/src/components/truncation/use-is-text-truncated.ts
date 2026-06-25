import {useEffect, useRef, useState} from 'react';

export function useIsTextTruncated<TElement extends HTMLElement>(text: string) {
  const ref = useRef<TElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
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
  }, [text]);

  return {ref, isTruncated};
}
