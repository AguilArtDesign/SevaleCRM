import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { hasPermission, type Permission } from '@sevale/permissions';
import { useCurrentUser } from '../users/useCurrentUser';

export function PermissionRoute({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { user, isLoading, error } = useCurrentUser();
  if (isLoading) return <main className="admin-page" aria-busy="true" />;
  if (error || !user || !hasPermission(user.role, permission)) {
    return <Navigate to="/app" replace />;
  }
  return children;
}
