import { useEffect, useRef } from 'react';
/** Close a conditionally mounted sheet without leaving its browser history entry behind. */
export function useSheetClose(onClose: () => void): () => Promise<void> {
  const entry = useRef<string | undefined>(undefined);
  const closing = useRef(false);
  const callback = useRef(onClose);
  callback.current = onClose;
  // Child Sheet effects push their entry before this parent effect runs.
  useEffect(() => {
    entry.current = window.history.state?.__overlay;
  }, []);
  return async () => {
    if (closing.current) return;
    closing.current = true;
    if (entry.current && window.history.state?.__overlay === entry.current) {
      await new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener('popstate', done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, 500);
        window.addEventListener('popstate', done);
        window.history.back();
      });
    }
    callback.current();
    closing.current = false;
  };
}
