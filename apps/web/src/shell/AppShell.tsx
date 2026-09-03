import { useEffect, useState } from 'react';
import { Button, Popover, Spinner, Typography } from '@heroui/react';
import {
  ArrowRightFromSquare,
  Bars,
  Boxes3,
  ChevronDown,
  Moon,
  Persons,
  ShieldKeyhole,
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

const pageMeta = {
  '/inventory': {
    title: 'Inventario',
    description: 'Consulta y sincronización de productos',
  },
  '/users': {
    title: 'Usuarios',
    description: 'Administración de cuentas y permisos',
  },
} as const;

function initials(name?: string): string {
  if (!name) return 'SC';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function AppShell() {
  useRealtimeUpdates();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading } = useCurrentUser();
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const currentPage =
    pageMeta[location.pathname as keyof typeof pageMeta] ?? pageMeta['/inventory'];

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const logout = async () => {
    await authClient.signOut();
    void navigate('/login', { replace: true });
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
    <div className="crm-shell">
      <aside className={`crm-sidebar${isSidebarOpen ? ' crm-sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">
            <ShieldKeyhole width={25} height={25} />
          </span>
          <div>
            <strong>SevaleCRM</strong>
            <span>Panel administrativo</span>
          </div>
          <Button
            className="sidebar-close"
            isIconOnly
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

        <div className="sidebar-session">
          <span className="user-avatar" aria-hidden="true">
            {initials(user?.name)}
          </span>
          <div>
            <strong>{user?.name || 'Usuario'}</strong>
            <span>{user ? roleLabels[user.role] : 'Sesión activa'}</span>
          </div>
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
          <div className="crm-header-title">
            <Button
              className="sidebar-open"
              isIconOnly
              variant="ghost"
              aria-label="Abrir navegación"
              onPress={() => setIsSidebarOpen(true)}
            >
              <Bars width={20} height={20} />
            </Button>
            <div>
              <Typography.Heading level={1}>{currentPage.title}</Typography.Heading>
              <Typography.Paragraph color="muted" size="sm">
                {currentPage.description}
              </Typography.Paragraph>
            </div>
          </div>

          <div className="crm-header-actions">
            <Button
              isIconOnly
              variant="ghost"
              aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              onPress={toggleTheme}
            >
              {theme === 'dark' ? <Sun width={19} height={19} /> : <Moon width={19} height={19} />}
            </Button>

            <NotificationCenter />

            <Popover>
              <Popover.Trigger className="user-menu-button" aria-label="Abrir menú de usuario">
                <span className="user-avatar" aria-hidden="true">
                  {initials(user?.name)}
                </span>
                <span className="user-menu-copy">
                  <strong>{user?.name || 'Usuario'}</strong>
                  <small>{user?.email}</small>
                </span>
                <ChevronDown width={16} height={16} />
              </Popover.Trigger>
              <Popover.Content placement="bottom end" className="shell-popover user-popover">
                <Popover.Dialog>
                  <div className="user-popover-heading">
                    <span className="user-avatar user-avatar-large" aria-hidden="true">
                      {initials(user?.name)}
                    </span>
                    <div>
                      <strong>{user?.name}</strong>
                      <span>{user?.email}</span>
                      <small>{user ? roleLabels[user.role] : ''}</small>
                    </div>
                  </div>
                  <div className="user-popover-actions">
                    <Button variant="ghost" fullWidth onPress={() => void logout()}>
                      <ArrowRightFromSquare width={17} height={17} />
                      Cerrar sesión
                    </Button>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </div>
        </header>

        <main className="crm-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
