import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authClient } from './auth-client';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) return <main className="auth-page" aria-busy="true" />;
  if (!session.data?.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}
