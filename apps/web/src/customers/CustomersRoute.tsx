import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../users/useCurrentUser';

export function CustomersRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, error } = useCurrentUser();
  if (isLoading) return <main className="admin-page" aria-busy="true" />;
  if (error || (user?.role !== 'ADMIN' && user?.role !== 'COMMERCIAL')) {
    return <Navigate to="/app" replace />;
  }
  return children;
}
