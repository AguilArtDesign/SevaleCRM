import { Button } from '@heroui/react';
import { Moon, Sun } from '@gravity-ui/icons';
import { useTheme } from './ThemeProvider';

/**
 * Interruptor de tema compartido por el login y el panel, para que el control se vea igual dentro y
 * fuera del shell. El posicionamiento lo define quien lo coloca mediante `className`.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      className={['shell-icon-button', className].filter(Boolean).join(' ')}
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onPress={toggleTheme}
    >
      {isDark ? <Sun width={19} height={19} /> : <Moon width={19} height={19} />}
    </Button>
  );
}
