import { Turnstile } from 'react-turnstile';
import { useTheme } from '../theme/ThemeProvider';

type TurnstileFieldProps = { onTokenChange: (token: string) => void; resetKey: number };

export function TurnstileField({ onTokenChange, resetKey }: TurnstileFieldProps) {
  const { theme } = useTheme();

  if (import.meta.env.DEV) return null;

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

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
        size="invisible"
        execution="execute"
        retry="never"
        onLoad={(_widgetId, turnstile) => turnstile.execute()}
        onVerify={onTokenChange}
        onExpire={(_token, turnstile) => {
          onTokenChange('');
          turnstile.reset();
          turnstile.execute();
        }}
        onError={() => onTokenChange('')}
      />
    </div>
  );
}
