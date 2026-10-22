import { Monitor, Moon, Sun } from 'lucide-react';
import { useLocale } from '../i18n';
import { useTheme } from '../theme';

export function ThemePicker() {
  const { mode, setTheme } = useTheme();
  const { t } = useLocale();
  const Icon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun;
  return (
    <label
      className="theme-picker"
      title={`${t('Appearance')}: ${t(mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light')}`}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="sr-only">{t('Appearance')}</span>
      <select
        value={mode}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'light' || value === 'dark' || value === 'system') setTheme(value);
        }}
      >
        <option value="light">{t('Light')}</option>
        <option value="dark">{t('Dark')}</option>
        <option value="system">{t('System')}</option>
      </select>
    </label>
  );
}
