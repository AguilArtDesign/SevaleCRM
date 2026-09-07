import { useEffect, useRef } from 'react';
import { Toast } from '@heroui/react';
import { authClient } from './auth-client';

export type SessionEndReason = 'absolute' | 'idle' | 'signed-out';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const WARNING_BEFORE_MS = 2 * 60 * 1000;
const SESSION_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 1000;
const ACTIVITY_STORAGE_KEY = 'sevale-crm.session-activity';

type StoredActivity = {
  sessionId: string;
  lastActivityAt: number;
};

function readStoredActivity(): StoredActivity | null {
  try {
    const value = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredActivity>;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.lastActivityAt !== 'number' ||
      !Number.isFinite(parsed.lastActivityAt)
    ) {
      return null;
    }
    return { sessionId: parsed.sessionId, lastActivityAt: parsed.lastActivityAt };
  } catch {
    return null;
  }
}

function storeActivity(activity: StoredActivity): void {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activity));
  } catch {
    // La sesión sigue protegida por los vencimientos del servidor y de esta pestaña.
  }
}

export function clearSessionActivity(): void {
  try {
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // No es necesario bloquear el cierre de sesión si el almacenamiento no está disponible.
  }
}

export function useSessionSecurity(onSessionEnd: (reason: SessionEndReason) => void): void {
  const session = authClient.useSession();
  const onSessionEndRef = useRef(onSessionEnd);

  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);

  useEffect(() => {
    const sessionId = session.data?.session.id;
    const sessionCreatedAt = session.data?.session.createdAt;
    if (!sessionId || !sessionCreatedAt) return;

    const createdAt = new Date(sessionCreatedAt).getTime();
    let lastActivityAt = Date.now();
    let lastActivityWriteAt = 0;
    let lastSessionRefreshAt = Date.now();
    let hasWarned = false;
    let isEnding = false;

    const storedActivity = readStoredActivity();
    if (storedActivity?.sessionId === sessionId) {
      lastActivityAt = storedActivity.lastActivityAt;
    } else {
      storeActivity({ sessionId, lastActivityAt });
    }

    const endSession = (reason: SessionEndReason) => {
      if (isEnding) return;
      isEnding = true;
      clearSessionActivity();
      onSessionEndRef.current(reason);
    };

    const hasExpired = (now = Date.now()): boolean => {
      if (!Number.isFinite(createdAt) || now - createdAt >= ABSOLUTE_TIMEOUT_MS) {
        endSession('absolute');
        return true;
      }
      if (now - lastActivityAt >= IDLE_TIMEOUT_MS) {
        endSession('idle');
        return true;
      }
      return false;
    };

    const refreshServerSession = (now: number) => {
      if (now - lastSessionRefreshAt < SESSION_REFRESH_INTERVAL_MS) return;
      lastSessionRefreshAt = now;
      void authClient
        .getSession()
        .then((result) => {
          if (!result.data) endSession('idle');
        })
        .catch(() => undefined);
    };

    const recordActivity = () => {
      const now = Date.now();
      if (hasExpired(now)) return;
      lastActivityAt = now;
      hasWarned = false;
      refreshServerSession(now);
      if (now - lastActivityWriteAt < ACTIVITY_WRITE_INTERVAL_MS) return;
      lastActivityWriteAt = now;
      storeActivity({ sessionId, lastActivityAt });
    };

    const checkTimeouts = () => {
      const now = Date.now();
      if (hasExpired(now)) return;
      const remainingIdleTime = IDLE_TIMEOUT_MS - (now - lastActivityAt);
      if (!hasWarned && remainingIdleTime <= WARNING_BEFORE_MS) {
        hasWarned = true;
        Toast.toast.warning('Tu sesión está por cerrarse', {
          description: 'Se cerrará en 2 minutos si no detectamos actividad.',
          timeout: 8_000,
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || hasExpired()) return;
      recordActivity();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVITY_STORAGE_KEY) return;
      if (!event.newValue) {
        endSession('signed-out');
        return;
      }
      const activity = readStoredActivity();
      if (activity?.sessionId === sessionId) {
        lastActivityAt = Math.max(lastActivityAt, activity.lastActivityAt);
        hasWarned = false;
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'keydown',
      'pointerdown',
      'pointermove',
      'scroll',
      'touchstart',
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, recordActivity, { passive: true }),
    );
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const timeoutInterval = window.setInterval(checkTimeouts, 15_000);
    checkTimeouts();

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(timeoutInterval);
    };
  }, [session.data?.session.createdAt, session.data?.session.id]);
}
