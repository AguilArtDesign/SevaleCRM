import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { InventoryPage } from './inventory/InventoryPage';
import { AppShell } from './shell/AppShell';
import { AdminRoute } from './users/AdminRoute';
import { UsersPage } from './users/UsersPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/inventory" element={<InventoryPage />} />
        <Route
          path="/users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="/app" element={<Navigate to="/inventory" replace />} />
      <Route path="*" element={<Navigate to="/inventory" replace />} />
    </Routes>
  );
}
