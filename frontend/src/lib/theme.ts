import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'threatorbit-theme';

function stored(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Light, dark, or follow the device. Kept in this browser only. */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePreference>(stored);

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just lasts for this visit */
    }
    setPrefState(next);
  }, []);

  return { pref, setPref };
}
