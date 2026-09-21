import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../users/useCurrentUser';

export function OrdersRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, error } = useCurrentUser();
  if (isLoading) return <main className="admin-page" aria-busy="true" />;
  if (error || !user) return <Navigate to="/app" replace />;
  return children;
}
