import { Button } from '@heroui/react';
import { Moon, Sun } from '@gravity-ui/icons';
import { useTheme } from '../theme/ThemeProvider';

export function ThemeButton() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      className="theme-button"
      isIconOnly
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      variant="secondary"
      onPress={toggleTheme}
    >
      {isDark ? <Sun width={19} height={19} /> : <Moon width={19} height={19} />}
    </Button>
  );
}
