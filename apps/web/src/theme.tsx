import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type ThemeMode = 'light' | 'dark' | 'system';
function parseMode(value: string | null | undefined): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}
const subscribeScheme = (onChange: () => void) => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const ThemeContext = createContext<{
  theme: 'light' | 'dark';
  setTheme: (mode: ThemeMode) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState(() =>
    parseMode(document.documentElement.dataset['themePreference']),
  );
  const darkSystem = useSyncExternalStore(
    subscribeScheme,
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const theme = mode === 'system' ? (darkSystem ? 'dark' : 'light') : mode;
  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // A blocked storage write must not prevent changing the current theme.
    }
  }, []);
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      root.dataset['themePreference'] = mode;
      root.dataset['theme'] = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim());
    };
    const stored = (event: StorageEvent) => {
      if (event.key === 'theme' || event.key === null) setMode(parseMode(event.newValue));
    };
    apply();
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener('storage', stored);
    };
  }, [mode, theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('Appearance settings require the theme provider');
  return value;
}
