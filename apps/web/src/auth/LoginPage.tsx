import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, InputOTP, Label, TextField, Typography } from '@heroui/react';
import { Envelope, Key } from '@gravity-ui/icons';
import { emailSchema, otpSchema, passwordSchema } from '@sevale/validation';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authClient } from './auth-client';
import { BrandMark } from './BrandMark';
import { ThemeButton } from './ThemeButton';
import { TurnstileField } from './TurnstileField';
import { Input } from '../components/Input';

type LoginMode = 'email' | 'password' | 'otp';
const CAPTCHA_REQUIRED = import.meta.env.PROD;

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'No pudimos completar la solicitud. Inténtalo nuevamente.';
}

function isServerAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = Number(candidate.status ?? candidate.statusCode);
  return Number.isFinite(status) && status >= 500;
}

export function LoginPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<LoginMode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    () => (location.state as { notice?: string } | null)?.notice || '',
  );
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(
      () => setResendSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  if (session.isPending) return <main className="auth-page" aria-busy="true" />;
  if (session.data?.user) {
    const destination = (location.state as { from?: string } | null)?.from || '/app';
    return <Navigate to={destination} replace />;
  }

  const resetFeedback = () => {
    setError('');
    setNotice('');
  };
  const resetCaptcha = () => {
    setCaptchaToken('');
    setCaptchaResetKey((value) => value + 1);
  };
  const switchMode = (nextMode: LoginMode) => {
    resetFeedback();
    resetCaptcha();
    setMode(nextMode);
  };

  const requestCode = async () => {
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) throw new Error(parsedEmail.error.issues[0]?.message);
    if (CAPTCHA_REQUIRED && !captchaToken) {
      throw new Error('Completa la verificación de seguridad.');
    }

    const result = await authClient.emailOtp.sendVerificationOtp({
      email: parsedEmail.data,
      type: 'sign-in',
      fetchOptions: { headers: { 'x-captcha-response': captchaToken } },
    });
    if (result.error) throw new Error(result.error.message || 'No fue posible enviar el código.');

    setEmail(parsedEmail.data);
    setMode('otp');
    setOtp('');
    setResendSeconds(60);
    setNotice('Si el correo está habilitado, recibirás un código de acceso.');
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setIsSubmitting(true);
    try {
      await requestCode();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      resetCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    const parsedEmail = emailSchema.safeParse(email);
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedEmail.success || !parsedPassword.success) {
      setError(
        parsedEmail.error?.issues[0]?.message ||
          parsedPassword.error?.issues[0]?.message ||
          'Revisa los datos.',
      );
      return;
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setError('Completa la verificación de seguridad.');
      return;
    }

    setIsSubmitting(true);
    const result = await authClient.signIn.email({
      email: parsedEmail.data,
      password: parsedPassword.data,
      fetchOptions: { headers: { 'x-captcha-response': captchaToken } },
    });
    setIsSubmitting(false);
    if (result.error) {
      setError('El correo o la contraseña no son correctos.');
      resetCaptcha();
      return;
    }
    void navigate('/app', { replace: true });
  };

  const handleOtpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    const parsedOtp = otpSchema.safeParse(otp);
    if (!parsedOtp.success) {
      setError(parsedOtp.error.issues[0]?.message || 'Revisa el código.');
      return;
    }

    setIsSubmitting(true);
    const result = await authClient.signIn.emailOtp({ email, otp: parsedOtp.data });
    setIsSubmitting(false);
    if (result.error) {
      setError(
        isServerAuthError(result.error)
          ? 'No pudimos iniciar sesión por un error del servidor. Inténtalo nuevamente.'
          : 'El código no es válido o ya expiró.',
      );
      return;
    }
    void navigate('/app', { replace: true });
  };

  const handleResend = () => {
    if (resendSeconds > 0 || isSubmitting) return;
    switchMode('email');
    setNotice('Completa nuevamente la verificación para reenviar el código.');
  };

  return (
    <main className="auth-page">
      <ThemeButton />
      <Card className="auth-card">
        <Card.Content className="auth-card-content">
          <BrandMark />
          <div className="auth-heading">
            <Typography.Heading level={1}>
              {mode === 'password'
                ? 'Iniciar con contraseña'
                : mode === 'otp'
                  ? 'Revisa tu correo'
                  : 'Iniciar sesión'}
            </Typography.Heading>
            {mode === 'otp' && (
              <Typography.Paragraph color="muted" size="sm">
                Ingresa el código enviado a {maskEmail(email)}
              </Typography.Paragraph>
            )}
          </div>

          {error && (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {notice && (
            <Alert status="success">
              <Alert.Content>
                <Alert.Description>{notice}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          {mode === 'email' && (
            <form
              className="auth-form"
              onSubmit={(event) => void handleEmailSubmit(event)}
              noValidate
            >
              <TextField fullWidth name="email" type="email" isRequired>
                <Label>Correo electrónico</Label>
                <Input
                  variant="secondary"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="correo@sevale.com"
                  autoComplete="email"
                />
              </TextField>
              <TurnstileField resetKey={captchaResetKey} onTokenChange={setCaptchaToken} />
              <Button fullWidth type="submit" variant="primary" isPending={isSubmitting}>
                Continuar
              </Button>
            </form>
          )}

          {mode === 'password' && (
            <form
              className="auth-form"
              onSubmit={(event) => void handlePasswordSubmit(event)}
              noValidate
            >
              <TextField fullWidth name="email" type="email" isRequired>
                <Label>Correo electrónico</Label>
                <Input
                  variant="secondary"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </TextField>
              <TextField fullWidth name="password" type="password" isRequired>
                <Label>Contraseña</Label>
                <Input
                  variant="secondary"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </TextField>
              <TurnstileField resetKey={captchaResetKey} onTokenChange={setCaptchaToken} />
              <Button fullWidth type="submit" variant="primary" isPending={isSubmitting}>
                Iniciar sesión
              </Button>
            </form>
          )}

          {mode === 'otp' && (
            <form
              className="auth-form"
              onSubmit={(event) => void handleOtpSubmit(event)}
              noValidate
            >
              <div className="otp-field">
                <Label>Código de verificación</Label>
                <InputOTP
                  value={otp}
                  onChange={setOtp}
                  maxLength={6}
                  inputMode="numeric"
                  isDisabled={isSubmitting}
                >
                  <InputOTP.Group>
                    {Array.from({ length: 6 }, (_, index) => (
                      <InputOTP.Slot key={index} index={index} />
                    ))}
                  </InputOTP.Group>
                </InputOTP>
              </div>
              <Button fullWidth type="submit" variant="primary" isPending={isSubmitting}>
                Verificar código
              </Button>
            </form>
          )}

          <div className="auth-actions">
            {mode === 'email' && (
              <Button variant="ghost" onPress={() => switchMode('password')}>
                <Key width={17} height={17} />
                Iniciar con contraseña
              </Button>
            )}
            {mode === 'password' && (
              <Button variant="ghost" onPress={() => switchMode('email')}>
                <Envelope width={17} height={17} />
                Usar código por correo
              </Button>
            )}
            {mode === 'otp' && (
              <>
                <Button variant="ghost" isDisabled={resendSeconds > 0} onPress={handleResend}>
                  {resendSeconds > 0 ? `Reenviar código en ${resendSeconds}s` : 'Reenviar código'}
                </Button>
                <Button variant="ghost" onPress={() => switchMode('email')}>
                  Usar otro correo
                </Button>
                <Button variant="ghost" onPress={() => switchMode('password')}>
                  Iniciar con contraseña
                </Button>
              </>
            )}
          </div>
        </Card.Content>
      </Card>
    </main>
  );
}
