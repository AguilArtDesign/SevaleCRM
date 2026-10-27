import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Avatar, Button, Spinner, Typography } from '@heroui/react';
import {
  ArrowRightFromSquare,
  Box,
  Briefcase,
  Gear,
  LayoutSideContentLeft,
  ListCheck,
  Persons,
  PersonsLock,
  PersonMagnifier,
  ShoppingCart,
  Ticket,
  Xmark,
} from '@gravity-ui/icons';
import { hasPermission, type Permission } from '@sevale/permissions';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authClient } from '../auth/auth-client';
import { ThemeToggle } from '../theme/ThemeToggle';
import { useCurrentUser } from '../users/useCurrentUser';
import { userAvatarGradient, userAvatarSeed, userInitials } from '../users/presentation';
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

type SidebarItem = {
  to: string;
  label: string;
  icon: ReactNode;
  /** Se oculta en lugar de mostrarse deshabilitado cuando el rol no alcanza el módulo. */
  when?: boolean;
};

type SidebarSection = { label: string; items: SidebarItem[] };

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sevale-crm.sidebar-collapsed';

function getStoredSidebarState(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
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

  const can = (permission: Permission) => Boolean(user && hasPermission(user.role, permission));

  // El menú se agrupa por área de trabajo: el orden va del día a día comercial a la
  // administración. Una sección sin entradas visibles desaparece con su encabezado.
  const sidebarSections: SidebarSection[] = [
    {
      label: 'Comercial',
      items: [
        {
          to: '/prospects',
          label: 'Prospectos',
          icon: <PersonMagnifier />,
          when: can('prospects.read'),
        },
        {
          to: '/customers',
          label: 'Clientes',
          icon: <Persons />,
          when: can('customers.read'),
        },
        { to: '/orders', label: 'Pedidos', icon: <ShoppingCart /> },
        { to: '/coupons', label: 'Cupones', icon: <Ticket />, when: can('coupons.read') },
      ],
    },
    {
      label: 'Convenios / Fidelización',
      items: [
        {
          to: '/agreements',
          label: 'Convenios',
          icon: <Briefcase />,
          when: can('agreements.read'),
        },
        {
          to: '/points-colombia',
          label: 'Puntos Colombia',
          // Logo de marca servido desde `public/img`: no es un ícono de la librería y sus colores
          // son los de la marca, así que no se recolorea con el tema.
          icon: <img className="sidebar-brand-icon" src="/img/puntos-colombia.svg" alt="" />,
          when: can('loyalty.read'),
        },
      ],
    },
    {
      label: 'Operación',
      items: [{ to: '/inventory', label: 'Inventario', icon: <Box /> }],
    },
    {
      label: 'Administración',
      items: [
        { to: '/users', label: 'Usuarios', icon: <PersonsLock />, when: user?.role === 'ADMIN' },
        {
          to: '/logs',
          label: 'Logs',
          icon: <ListCheck />,
          when: can('logs.read'),
        },
      ],
    },
  ]
    .map((section) => ({ ...section, items: section.items.filter((item) => item.when ?? true) }))
    .filter((section) => section.items.length > 0);

  return (
    <div className={`crm-shell${isSidebarCollapsed ? ' crm-shell-sidebar-collapsed' : ''}`}>
      <aside className={`crm-sidebar${isSidebarOpen ? ' crm-sidebar-open' : ''}`}>
        <div className="sidebar-profile">
          <Avatar size="md" aria-hidden="true">
            <Avatar.Fallback
              className="sidebar-user-avatar-fallback"
              style={userAvatarGradient(userAvatarSeed(user))}
            >
              {userInitials(user?.name)}
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
          {sidebarSections.map((section, index) => (
            <Fragment key={section.label}>
              <span
                className={`sidebar-section-label${index > 0 ? ' sidebar-section-spaced' : ''}`}
              >
                {section.label}
              </span>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' sidebar-link-active' : ''}`
                  }
                >
                  <span className="sidebar-menu-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </Fragment>
          ))}
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
            <ThemeToggle />

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
