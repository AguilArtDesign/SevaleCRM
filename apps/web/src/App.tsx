import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { InventoryPage } from './inventory/InventoryPage';
import { AppShell } from './shell/AppShell';
import { AdminRoute } from './users/AdminRoute';
import { UsersPage } from './users/UsersPage';
import { CustomersPage } from './customers/CustomersPage';
import { CustomersRoute } from './customers/CustomersRoute';
import { OrdersPage } from './orders/OrdersPage';
import { OrdersRoute } from './orders/OrdersRoute';
import { CouponsPage } from './coupons/CouponsPage';
import { AgreementsPage } from './agreements/AgreementsPage';
import { AgreementDetailPage } from './agreements/AgreementDetailPage';
import { ProspectsPage } from './prospects/ProspectsPage';
import { PointsColombiaPage } from './loyalty/PointsColombiaPage';
import { PermissionRoute } from './auth/PermissionRoute';

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
          path="/orders"
          element={
            <OrdersRoute>
              <OrdersPage />
            </OrdersRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <CustomersRoute>
              <CustomersPage />
            </CustomersRoute>
          }
        />
        <Route
          path="/coupons"
          element={
            <PermissionRoute permission="coupons.read">
              <CouponsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/agreements"
          element={
            <PermissionRoute permission="agreements.read">
              <AgreementsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/agreements/:id"
          element={
            <PermissionRoute permission="agreements.read">
              <AgreementDetailPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/prospects"
          element={
            <PermissionRoute permission="prospects.read">
              <ProspectsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/points-colombia"
          element={
            <PermissionRoute permission="loyalty.read">
              <PointsColombiaPage />
            </PermissionRoute>
          }
        />
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
