import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle({ className = 'icon-btn icon-btn--round' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} mode`} data-tip={`${next === 'dark' ? 'Dark' : 'Light'} mode`}>
      {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  );
}
