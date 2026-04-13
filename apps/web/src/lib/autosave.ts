'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebouncedAutosave(
  value: string,
  delayMs: number,
  save: (value: string) => Promise<void>,
): { saving: boolean } {
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const schedule = useCallback(
    (v: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await saveRef.current(v);
        } finally {
          setSaving(false);
        }
      }, delayMs);
    },
    [delayMs],
  );

  useEffect(() => {
    schedule(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { saving };
}
