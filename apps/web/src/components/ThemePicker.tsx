import { Moon, Sun } from 'lucide-react';
import { useLocale } from '../i18n';
import { useTheme } from '../theme';

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  const dark = theme === 'dark';
  const Icon = dark ? Sun : Moon;
  const label = t(dark ? 'Switch to light mode' : 'Switch to dark mode');
  return (
    <button
      type="button"
      className="theme-picker"
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
