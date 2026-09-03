import { Turnstile } from 'react-turnstile';
import { useTheme } from '../theme/ThemeProvider';

const DEVELOPMENT_SITE_KEY = '1x00000000000000000000AA';

type TurnstileFieldProps = { onTokenChange: (token: string) => void; resetKey: number };

export function TurnstileField({ onTokenChange, resetKey }: TurnstileFieldProps) {
  const { theme } = useTheme();
  const configuredSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const siteKey = configuredSiteKey || (import.meta.env.DEV ? DEVELOPMENT_SITE_KEY : '');

  if (!siteKey) {
    return (
      <p className="form-message form-message-error" role="alert">
        La protección Turnstile no está configurada.
      </p>
    );
  }

  return (
    <div className="turnstile-field" aria-label="Verificación de seguridad">
      <Turnstile
        key={resetKey}
        sitekey={siteKey}
        theme={theme}
        size="flexible"
        onVerify={onTokenChange}
        onExpire={() => onTokenChange('')}
        onError={() => onTokenChange('')}
      />
    </div>
  );
}
