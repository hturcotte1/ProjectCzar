import { useEffect, useState } from 'react';

/** True while the CSS media query matches; follows changes (rotating a phone, resizing a window). */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    fn();
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return on;
}

/** Phones: the width at which the room page switches to its most compact layout. */
export const PHONE_QUERY = '(max-width: 600px)';
