import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Avatar, Button, Spinner, Typography } from '@heroui/react';
import {
  ArrowRightFromSquare,
  Boxes3,
  Gear,
  LayoutSideContentLeft,
  Moon,
  Persons,
  Sun,
  Xmark,
} from '@gravity-ui/icons';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authClient } from '../auth/auth-client';
import { useTheme } from '../theme/ThemeProvider';
import { useCurrentUser } from '../users/useCurrentUser';
import { useRealtimeUpdates } from '../realtime/useRealtimeUpdates';
import { NotificationCenter } from '../notifications/NotificationCenter';
import {
  clearSessionActivity,
  useSessionSecurity,
  type SessionEndReason,
} from '../auth/useSessionSecurity';

const roleLabels = {
  ADMIN: 'Administrador',
  COMMERCIAL: 'Comercial',
  LOGISTICS: 'Logística',
} as const;

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sevale-crm.sidebar-collapsed';

type AvatarGradientStyle = CSSProperties & {
  '--avatar-from': string;
  '--avatar-to': string;
};

function getStoredSidebarState(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function avatarGradient(seed?: string): AvatarGradientStyle {
  let hash = 2_166_136_261;
  for (const character of seed || 'SevaleCRM') {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const unsignedHash = hash >>> 0;
  const startHue = unsignedHash % 360;
  const endHue = (startHue + 50 + ((unsignedHash >>> 8) % 71)) % 360;
  return {
    '--avatar-from': `hsl(${startHue} 72% 42%)`,
    '--avatar-to': `hsl(${endHue} 78% 50%)`,
  };
}

function initials(name?: string): string {
  if (!name) return 'SC';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function firstName(name?: string): string {
  return name?.trim().split(/\s+/)[0] || 'Usuario';
}

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function AppShell() {
  useRealtimeUpdates();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading } = useCurrentUser();
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(getStoredSidebarState);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches,
  );
  const isSidebarVisible = isMobile ? isSidebarOpen : !isSidebarCollapsed;

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 900px)');
    if (!mediaQuery) return;

    const updateViewport = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
    } catch {
      // La navegación sigue funcionando aunque el navegador bloquee el almacenamiento local.
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const syncSidebarState = (event: StorageEvent) => {
      if (event.key === SIDEBAR_COLLAPSED_STORAGE_KEY) {
        setIsSidebarCollapsed(event.newValue === 'true');
      }
    };
    window.addEventListener('storage', syncSidebarState);
    return () => window.removeEventListener('storage', syncSidebarState);
  }, []);

  const logout = useCallback(
    async (reason?: SessionEndReason) => {
      try {
        await authClient.signOut();
      } finally {
        clearSessionActivity();
        const notice =
          reason === 'idle'
            ? 'La sesión se cerró después de 2 horas sin actividad.'
            : reason === 'absolute'
              ? 'La sesión finalizó al alcanzar el límite de 8 horas.'
              : undefined;
        void navigate('/login', { replace: true, state: notice ? { notice } : undefined });
      }
    },
    [navigate],
  );

  useSessionSecurity((reason) => void logout(reason));

  const toggleSidebar = () => {
    if (isMobile) {
      setIsSidebarOpen((isOpen) => !isOpen);
      return;
    }

    setIsSidebarCollapsed((isCollapsed) => !isCollapsed);
  };

  if (isLoading) {
    return (
      <main className="shell-loading" aria-busy="true">
        <Spinner />
        <span>Preparando tu espacio de trabajo…</span>
      </main>
    );
  }

  return (
    <div className={`crm-shell${isSidebarCollapsed ? ' crm-shell-sidebar-collapsed' : ''}`}>
      <aside className={`crm-sidebar${isSidebarOpen ? ' crm-sidebar-open' : ''}`}>
        <div className="sidebar-profile">
          <Avatar size="md" aria-hidden="true">
            <Avatar.Fallback
              className="sidebar-user-avatar-fallback"
              style={avatarGradient(user?.id || user?.email || user?.name)}
            >
              {initials(user?.name)}
            </Avatar.Fallback>
          </Avatar>
          <div>
            <strong>{user?.name || 'Usuario'}</strong>
            <span>{user ? roleLabels[user.role] : 'Sesión activa'}</span>
          </div>
          <Button
            className="sidebar-close"
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Cerrar navegación"
            onPress={() => setIsSidebarOpen(false)}
          >
            <Xmark width={19} height={19} />
          </Button>
        </div>

        <nav className="sidebar-nav" aria-label="Navegación principal">
          <NavLink
            to="/inventory"
            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
          >
            <span className="sidebar-menu-icon" aria-hidden="true">
              <Boxes3 />
            </span>
            <span>Inventario</span>
          </NavLink>

          {user?.role === 'ADMIN' && (
            <>
              <NavLink
                to="/users"
                className={({ isActive }) =>
                  `sidebar-link${isActive ? ' sidebar-link-active' : ''}`
                }
              >
                <span className="sidebar-menu-icon" aria-hidden="true">
                  <Persons />
                </span>
                <span>Usuarios</span>
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <Button
            className="sidebar-footer-action"
            fullWidth
            variant="ghost"
            isDisabled
            aria-label="Configuración, próximamente"
          >
            <span className="sidebar-menu-icon" aria-hidden="true">
              <Gear />
            </span>
            <span>Configuración</span>
          </Button>
          <Button
            className="sidebar-footer-action"
            fullWidth
            variant="ghost"
            onPress={() => void logout()}
          >
            <span className="sidebar-menu-icon" aria-hidden="true">
              <ArrowRightFromSquare />
            </span>
            <span>Cerrar sesión</span>
          </Button>
        </div>
      </aside>

      {isSidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="crm-workspace">
        <header className="crm-header">
          <div className="crm-header-welcome">
            <Button
              className="sidebar-toggle"
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={isSidebarVisible ? 'Ocultar navegación' : 'Mostrar navegación'}
              aria-expanded={isSidebarVisible}
              onPress={toggleSidebar}
            >
              <LayoutSideContentLeft width={18} height={18} />
            </Button>
            <Typography.Heading level={1}>
              {greeting()}, {firstName(user?.name)}
            </Typography.Heading>
          </div>

          <div className="crm-header-actions">
            <Button
              className="shell-icon-button"
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              onPress={toggleTheme}
            >
              {theme === 'dark' ? <Sun width={19} height={19} /> : <Moon width={19} height={19} />}
            </Button>

            <NotificationCenter />
          </div>
        </header>

        <main className="crm-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
