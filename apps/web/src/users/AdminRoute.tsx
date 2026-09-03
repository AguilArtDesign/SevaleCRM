import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from './useCurrentUser';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, error } = useCurrentUser();
  if (isLoading) return <main className="admin-page" aria-busy="true" />;
  if (error || user?.role !== 'ADMIN') return <Navigate to="/app" replace />;
  return children;
}
