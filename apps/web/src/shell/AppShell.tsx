import { useEffect, useState } from 'react';
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

const roleLabels = {
  ADMIN: 'Administrador',
  COMMERCIAL: 'Comercial',
  LOGISTICS: 'Logística',
} as const;

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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

  const logout = async () => {
    await authClient.signOut();
    void navigate('/login', { replace: true });
  };

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
          <Avatar color="accent" size="sm" variant="soft" aria-hidden="true">
            <Avatar.Fallback>{initials(user?.name)}</Avatar.Fallback>
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
          <span className="sidebar-section-label">Operación</span>
          <NavLink
            to="/inventory"
            className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
          >
            <Boxes3 width={19} height={19} />
            <span>Inventario</span>
          </NavLink>

          {user?.role === 'ADMIN' && (
            <>
              <span className="sidebar-section-label sidebar-section-spaced">Administración</span>
              <NavLink
                to="/users"
                className={({ isActive }) =>
                  `sidebar-link${isActive ? ' sidebar-link-active' : ''}`
                }
              >
                <Persons width={19} height={19} />
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
            <Gear width={18} height={18} />
            Configuración
          </Button>
          <Button
            className="sidebar-footer-action"
            fullWidth
            variant="ghost"
            onPress={() => void logout()}
          >
            <ArrowRightFromSquare width={18} height={18} />
            Cerrar sesión
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
