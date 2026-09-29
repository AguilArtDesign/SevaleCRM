import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, InputOTP, Label, Spinner, TextField, Typography } from '@heroui/react';
import { Envelope, PaperPlane, ShieldKeyhole } from '@gravity-ui/icons';
import { emailSchema, otpSchema, passwordSchema } from '@sevale/validation';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { authClient } from './auth-client';
import { BrandMark } from './BrandMark';
import { ThemeToggle } from '../theme/ThemeToggle';
import { TurnstileField } from './TurnstileField';
import { Input } from '../components/Input';

type LoginMode = 'email' | 'password' | 'otp';
const CAPTCHA_REQUIRED = import.meta.env.PROD;

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

type NoticeTone = 'warning' | 'danger';
type LoginNotice = { text: string; tone: NoticeTone };

/**
 * Error que lleva el tono con el que debe mostrarse: los fallos que el usuario puede corregir se
 * marcan como `warning` y los del sistema como `danger`.
 */
class LoginNoticeError extends Error {
  constructor(
    message: string,
    readonly tone: NoticeTone = 'warning',
  ) {
    super(message);
  }
}

/** Cualquier error no clasificado viene de la API o de la red, así que se muestra como `danger`. */
function noticeFrom(error: unknown): LoginNotice {
  if (error instanceof LoginNoticeError) return { text: error.message, tone: error.tone };
  return {
    text:
      error instanceof Error && error.message
        ? error.message
        : 'No pudimos completar la solicitud. Inténtalo nuevamente.',
    tone: 'danger',
  };
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
  const otpVerificationRef = useRef(false);
  const [error, setError] = useState<LoginNotice | null>(null);
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
    setError(null);
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
    if (!parsedEmail.success) {
      throw new LoginNoticeError(
        parsedEmail.error.issues[0]?.message ?? 'Ingresa un correo válido.',
      );
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      throw new LoginNoticeError('Completa la verificación de seguridad.');
    }

    const result = await authClient.emailOtp.sendVerificationOtp({
      email: parsedEmail.data,
      type: 'sign-in',
      fetchOptions: { headers: { 'x-captcha-response': captchaToken } },
    });
    if (result.error) {
      throw new LoginNoticeError(
        result.error.message || 'No fue posible enviar el código.',
        isServerAuthError(result.error) ? 'danger' : 'warning',
      );
    }

    setEmail(parsedEmail.data);
    setMode('otp');
    setOtp('');
    setResendSeconds(60);
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setIsSubmitting(true);
    try {
      await requestCode();
    } catch (requestError) {
      setError(noticeFrom(requestError));
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
      setError({
        text:
          parsedEmail.error?.issues[0]?.message ||
          parsedPassword.error?.issues[0]?.message ||
          'Revisa los datos.',
        tone: 'warning',
      });
      return;
    }
    if (CAPTCHA_REQUIRED && !captchaToken) {
      setError({ text: 'Completa la verificación de seguridad.', tone: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.email({
        email: parsedEmail.data,
        password: parsedPassword.data,
        fetchOptions: { headers: { 'x-captcha-response': captchaToken } },
      });
      if (result.error) {
        setError({ text: 'El correo o la contraseña no son correctos.', tone: 'warning' });
        resetCaptcha();
        return;
      }
      void navigate('/app', { replace: true });
    } catch (passwordError) {
      setError(noticeFrom(passwordError));
      resetCaptcha();
    } finally {
      // Sin esto, un fallo de red dejaría el indicador de carga bloqueado.
      setIsSubmitting(false);
    }
  };

  /**
   * Verifica el código contra la API. Se invoca al completar los seis dígitos y también desde el
   * botón, por lo que `otpVerificationRef` evita dos peticiones simultáneas con el mismo código.
   */
  const verifyOtp = async (code: string) => {
    if (otpVerificationRef.current) return;
    resetFeedback();
    const parsedOtp = otpSchema.safeParse(code);
    if (!parsedOtp.success) {
      setError({
        text: parsedOtp.error.issues[0]?.message || 'Revisa el código.',
        tone: 'warning',
      });
      return;
    }

    otpVerificationRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await authClient.signIn.emailOtp({ email, otp: parsedOtp.data });
      if (result.error) {
        const serverError = isServerAuthError(result.error);
        setError({
          text: serverError
            ? 'No pudimos iniciar sesión por un error del servidor. Inténtalo nuevamente.'
            : 'El código no es válido o ya expiró.',
          tone: serverError ? 'danger' : 'warning',
        });
        return;
      }
      void navigate('/app', { replace: true });
    } catch (verificationError) {
      setError(noticeFrom(verificationError));
    } finally {
      // Sin esto, un fallo de red dejaría el indicador de carga y el campo bloqueados.
      otpVerificationRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = (event: FormEvent) => {
    event.preventDefault();
    void verifyOtp(otp);
  };

  const handleResend = () => {
    if (resendSeconds > 0 || isSubmitting) return;
    switchMode('email');
    setNotice('Completa nuevamente la verificación para reenviar el código.');
  };

  return (
    <main className="auth-page">
      <ThemeToggle className="theme-button" />
      <Card className="auth-card">
        <Card.Content className="auth-card-content">
          <BrandMark />
          <div className="auth-heading">
            <Typography.Heading level={1} className="auth-title">
              {mode === 'password'
                ? 'Iniciar con contraseña'
                : mode === 'otp'
                  ? 'Verificar tu cuenta'
                  : 'Iniciar sesión'}
            </Typography.Heading>
            <Typography.Paragraph color="muted" size="sm">
              {mode === 'password'
                ? 'Introduce tus credenciales para acceder a tu cuenta.'
                : mode === 'otp'
                  ? `Ingresa el código enviado a ${maskEmail(email)}`
                  : 'Introduce tu correo electrónico para acceder'}
            </Typography.Paragraph>
          </div>

          {error && (
            <p className={`auth-notice auth-notice--${error.tone}`} role="alert">
              {error.text}
            </p>
          )}
          {notice && (
            <p className="auth-notice auth-notice--success" role="status">
              {notice}
            </p>
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
                {isSubmitting && <Spinner color="current" size="sm" />}
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
                {isSubmitting && <Spinner color="current" size="sm" />}
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
                  onChange={(code) => {
                    setOtp(code);
                    // El código se valida al completar los seis dígitos, sin pulsar el botón.
                    if (code.length === 6) void verifyOtp(code);
                  }}
                  maxLength={6}
                  inputMode="numeric"
                  variant="secondary"
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
                {isSubmitting && <Spinner color="current" size="sm" />}
              </Button>
            </form>
          )}

          <div className="auth-actions">
            {mode === 'email' && (
              <Button variant="ghost" onPress={() => switchMode('password')}>
                <ShieldKeyhole width={17} height={17} />
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
                  {resendSeconds > 0 ? (
                    `Reenviar código en ${resendSeconds}s`
                  ) : (
                    <>
                      <PaperPlane width={17} height={17} />
                      Reenviar código
                    </>
                  )}
                </Button>
                <Button variant="ghost" onPress={() => switchMode('email')}>
                  <Envelope width={17} height={17} />
                  Usar otro correo
                </Button>
                <Button variant="ghost" onPress={() => switchMode('password')}>
                  <ShieldKeyhole width={17} height={17} />
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
