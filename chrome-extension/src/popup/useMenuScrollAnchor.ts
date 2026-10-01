import { useLayoutEffect, useRef } from 'react';

/** Keep the date arrows under the pointer while a different menu loads. */
export function useMenuScrollAnchor(expanded: boolean, period: string, date: string, loading: boolean, data: unknown, error: string | null) {
  const anchor = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const targetY = useRef<number | null>(null);

  const capture = () => {
    targetY.current = anchor.current?.getBoundingClientRect().top ?? null;
  };

  useLayoutEffect(() => {
    targetY.current = null;
    if (content.current) content.current.style.minHeight = '';
  }, [expanded, period]);

  useLayoutEffect(() => {
    const body = content.current;
    const picker = anchor.current;
    if (!expanded || !body || !picker || targetY.current === null) return;
    body.style.minHeight = '';

    const compensate = () => {
      if (targetY.current === null || !picker.isConnected) return;
      let delta = picker.getBoundingClientRect().top - targetY.current;
      // At the top of the page we cannot scroll up any further. Reserve only
      // the missing space beneath the dishes to keep the arrows in place.
      if (window.scrollY + delta < 0) {
        body.style.minHeight = `${body.getBoundingClientRect().height - window.scrollY - delta}px`;
        delta = picker.getBoundingClientRect().top - targetY.current;
      }
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    };
    const stop = () => { targetY.current = null; };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
    };
    compensate();
    // The surrounding accordion animates its height after the dishes change,
    // so keep compensating as the browser's scroll range changes too.
    const observer = new ResizeObserver(compensate);
    observer.observe(body);
    const section = picker.closest('.dining-list');
    if (section) observer.observe(section);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded, period, date, loading, data, error]);

  return { anchor, content, capture };
}
