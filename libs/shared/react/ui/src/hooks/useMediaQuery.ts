import {useEffect, useState} from 'react';

class MediaQueryManager {
  private queries = new Map<string, MediaQueryList>();
  private listeners = new Map<string, Set<() => void>>();
  private changeHandlers = new Map<string, () => void>();

  getMatches(query: string): boolean {
    if (typeof window === 'undefined') return false;

    if (!this.queries.has(query)) {
      this.queries.set(query, window.matchMedia(query));
      this.listeners.set(query, new Set());
    }

    const mediaQuery = this.queries.get(query);
    return mediaQuery ? mediaQuery.matches : false;
  }

  subscribe(query: string, callback: () => void): () => void {
    if (typeof window === 'undefined') {
      return () => {
        // Cleanup function for SSR - no-op
      };
    }

    if (!this.queries.has(query)) {
      this.queries.set(query, window.matchMedia(query));
      this.listeners.set(query, new Set());
    }

    const mediaQuery = this.queries.get(query);
    const listeners = this.listeners.get(query);

    if (!mediaQuery || !listeners) {
      return () => {
        // Cleanup function - no-op if query wasn't found
      };
    }

    listeners.add(callback);

    if (listeners.size === 1) {
      const changeHandler = () => {
        for (const cb of listeners) {
          cb();
        }
      };
      this.changeHandlers.set(query, changeHandler);
      mediaQuery.addEventListener('change', changeHandler);
    }

    return () => {
      listeners.delete(callback);

      if (listeners.size === 0) {
        const changeHandler = this.changeHandlers.get(query);
        if (changeHandler) {
          mediaQuery.removeEventListener('change', changeHandler);
          this.changeHandlers.delete(query);
        }
        this.queries.delete(query);
        this.listeners.delete(query);
      }
    };
  }
}

const mediaQueryManager = new MediaQueryManager();

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaQueryManager.getMatches(query));

  useEffect(() => {
    const updateMatches = () => {
      setMatches(mediaQueryManager.getMatches(query));
    };

    const unsubscribe = mediaQueryManager.subscribe(query, updateMatches);

    updateMatches();

    return unsubscribe;
  }, [query]);

  return matches;
}
