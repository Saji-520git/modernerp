import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Clock } from 'lucide-react';
import ErrorBoundary from './components/common/ErrorBoundary';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/auth/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProductsPage from './pages/products/ProductsPage';
import POSPage from './pages/pos/POSPage';
import InventoryPage from './pages/inventory/InventoryPage';
import PurchasesPage from './pages/purchases/PurchasesPage';
import SuppliersPage from './pages/contacts/SuppliersPage';
import CustomersPage from './pages/contacts/CustomersPage';
import CustomerDetailPage from './pages/contacts/CustomerDetailPage';
import SalesPage from './pages/sales/SalesPage';
import UsersPage from './pages/users/UsersPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import UnitsPage from './pages/units/UnitsPage';
import ReturnsPage from './pages/returns/ReturnsPage';
import BarcodeLabelsPage from './pages/products/BarcodeLabelsPage';
import ExpensesPage from './pages/expenses/ExpensesPage';
import ShiftsPage from './pages/shifts/ShiftsPage';
import WarehousesPage from './pages/warehouses/WarehousesPage';
import AlertsPage from './pages/alerts/AlertsPage';
import ImportPage from './pages/settings/ImportPage';
import PurchaseReturnsPage from './pages/purchases/PurchaseReturnsPage';
import CategoriesPage from './pages/settings/CategoriesPage';
import BrandsPage from './pages/settings/BrandsPage';
import { useAuthStore } from './store/authStore';

// ─── Coming-soon stub ─────────────────────────────────────────────────────────

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
      <Clock size={40} className="text-slate-300" />
      <p className="text-lg font-semibold text-slate-600">{title}</p>
      <p className="text-sm">This module is coming soon.</p>
    </div>
  );
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.accessToken);
  return token ? children : <Navigate to="/login" replace />;
}

// ─── Cashier guard ────────────────────────────────────────────────────────────

function CashierGuard({ children }: { children: JSX.Element }) {
  const user     = useAuthStore((s) => s.user);
  const location = useLocation();

  if (user?.role !== 'CASHIER') return children;
  if (location.pathname.startsWith('/pos')) return children;

  return <Navigate to="/pos" replace />;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <Protected>
            <CashierGuard>
              <AppShell />
            </CashierGuard>
          </Protected>
        }
      >
        {/* MAIN */}
        <Route index element={
          <ErrorBoundary fallbackTitle="Dashboard failed to load">
            <DashboardPage />
          </ErrorBoundary>
        } />

        <Route path="pos" element={
          <ErrorBoundary fallbackTitle="POS failed to load">
            <POSPage />
          </ErrorBoundary>
        } />

        {/* CATALOG */}
        <Route path="products" element={
          <ErrorBoundary fallbackTitle="Products page failed to load">
            <ProductsPage />
          </ErrorBoundary>
        } />
        <Route path="barcodes" element={
          <ErrorBoundary fallbackTitle="Barcode Labels failed to load">
            <BarcodeLabelsPage />
          </ErrorBoundary>
        } />

        {/* INVENTORY */}
        <Route path="inventory" element={
          <ErrorBoundary fallbackTitle="Inventory page failed to load">
            <InventoryPage />
          </ErrorBoundary>
        } />
        <Route path="inventory/transfers"   element={<InventoryPage />} />
        <Route path="inventory/adjustments" element={<InventoryPage />} />
        <Route path="inventory/movements"   element={<InventoryPage />} />
        <Route path="warehouses" element={
          <ErrorBoundary fallbackTitle="Warehouses page failed to load">
            <WarehousesPage />
          </ErrorBoundary>
        } />

        {/* OPERATIONS */}
        <Route path="sales" element={
          <ErrorBoundary fallbackTitle="Sales page failed to load">
            <SalesPage />
          </ErrorBoundary>
        } />
        <Route path="purchases" element={
          <ErrorBoundary fallbackTitle="Purchases page failed to load">
            <PurchasesPage />
          </ErrorBoundary>
        } />
        <Route path="returns"  element={
          <ErrorBoundary fallbackTitle="Returns page failed to load">
            <ReturnsPage />
          </ErrorBoundary>
        } />
        <Route path="purchase-returns" element={
          <ErrorBoundary fallbackTitle="Purchase Returns page failed to load">
            <PurchaseReturnsPage />
          </ErrorBoundary>
        } />
        <Route path="expenses" element={
          <ErrorBoundary fallbackTitle="Expenses page failed to load">
            <ExpensesPage />
          </ErrorBoundary>
        } />
        <Route path="shifts" element={
          <ErrorBoundary fallbackTitle="POS Shifts failed to load">
            <ShiftsPage />
          </ErrorBoundary>
        } />
        <Route path="alerts" element={
          <ErrorBoundary fallbackTitle="Stock Alerts failed to load">
            <AlertsPage />
          </ErrorBoundary>
        } />

        {/* PEOPLE */}
        <Route path="customers" element={
          <ErrorBoundary fallbackTitle="Customers page failed to load">
            <CustomersPage />
          </ErrorBoundary>
        } />
        <Route path="customers/:id" element={
          <ErrorBoundary fallbackTitle="Customer detail failed to load">
            <CustomerDetailPage />
          </ErrorBoundary>
        } />
        <Route path="suppliers" element={
          <ErrorBoundary fallbackTitle="Suppliers page failed to load">
            <SuppliersPage />
          </ErrorBoundary>
        } />
        <Route path="contacts" element={<Navigate to="/suppliers" replace />} />

        {/* REPORTS */}
        <Route path="reports">
          <Route index element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="sales" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="purchases" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="products" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="customers" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="inventory" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          <Route path="profit-loss" element={
            <ErrorBoundary fallbackTitle="Reports failed to load">
              <ReportsPage />
            </ErrorBoundary>
          } />
          {/* Disabled — POS shift report not yet implemented
          <Route path="shifts" element={<ComingSoon title="POS Shift Reports" />} />
          */}
        </Route>

        {/* SYSTEM */}
        <Route path="users" element={
          <ErrorBoundary fallbackTitle="User Management failed to load">
            <UsersPage />
          </ErrorBoundary>
        } />
        <Route path="settings" element={
          <ErrorBoundary fallbackTitle="Settings failed to load">
            <SettingsPage />
          </ErrorBoundary>
        } />
        <Route path="settings/import" element={
          <ErrorBoundary fallbackTitle="Import page failed to load">
            <ImportPage />
          </ErrorBoundary>
        } />
        <Route path="settings/categories" element={<CategoriesPage />} />
        <Route path="settings/brands" element={<BrandsPage />} />

        {/* Legacy */}
        <Route path="units" element={<UnitsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
