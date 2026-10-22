import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ThemeMode = 'light' | 'dark' | 'system';
function parseMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}
const ThemeContext = createContext<{ mode: ThemeMode; setTheme: (mode: ThemeMode) => void } | null>(
  null,
);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(() =>
    parseMode(document.documentElement.dataset['themePreference']),
  );
  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // A blocked storage write must not prevent changing the current theme.
    }
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset['themePreference'] = mode;
      root.dataset['theme'] = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim());
    };
    const stored = (event: StorageEvent) => {
      if (event.key === 'theme' || event.key === null) setMode(parseMode(event.newValue));
    };
    apply();
    if (mode === 'system') media.addEventListener('change', apply);
    window.addEventListener('storage', stored);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener('storage', stored);
    };
  }, [mode]);
  const value = useMemo(() => ({ mode, setTheme }), [mode, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('Appearance settings require the theme provider');
  return value;
}
