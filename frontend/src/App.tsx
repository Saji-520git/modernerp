import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Clock, Loader2 } from 'lucide-react';
import { api } from './services/api';
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
import SupplierDetailPage from './pages/contacts/SupplierDetailPage';
import SalesPage from './pages/sales/SalesPage';
import UsersPage from './pages/users/UsersPage';
import ReportsPage from './pages/reports/ReportsPage';
import TodaySummaryPage from './pages/dashboard/TodaySummaryPage';
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
  // Validate any persisted session on startup. If the stored token is
  // expired/invalid the /auth/me call returns 401, the axios interceptor
  // clears the auth store, and the Protected guard redirects to /login.
  const [checking, setChecking] = useState(true);

  // v1.0.44 — session-expiry banner. The axios interceptor dispatches
  // 'auth:expired' on a 401 and delays the actual logout by 5s; this banner
  // counts down so the cashier sees the warning before being redirected.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [countdown, setCountdown] = useState(5);

  // v1.0.64 — belt-and-suspenders: any auth-state change (logout clears the
  // token, re-login sets it) clears a lingering expiry banner so it can never
  // persist across the login redirect.
  const accessToken = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    setSessionExpired(false);
    setCountdown(5);
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const token = useAuthStore.getState().accessToken;
    if (!token) { setChecking(false); return; }
    api.get('/auth/me')
      .catch(() => { /* interceptor handles 401 logout */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const handler = () => {
      setSessionExpired(true);
      setCountdown(5);
      interval = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (interval) clearInterval(interval);
            // Hide the banner — logout itself is handled by the api
            // interceptor's 5s setTimeout. Defer the state update out of
            // this updater to avoid a nested-setState warning.
            setTimeout(() => setSessionExpired(false), 0);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    };

    window.addEventListener('auth:expired', handler);

    return () => {
      window.removeEventListener('auth:expired', handler);
      if (interval) clearInterval(interval);
    };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-300">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {sessionExpired && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white px-4 py-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-lg">⚠</span>
            <div>
              <p className="font-bold text-sm">Session Expired</p>
              <p className="text-xs opacity-90">
                Redirecting to login in {countdown}s. Please note any unsaved information.
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-75">
              Your data is safe. Log back in to continue.
            </p>
          </div>
        </div>
      )}
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

        <Route path="dashboard/today" element={
          <ErrorBoundary fallbackTitle="Today's Summary failed to load">
            <TodaySummaryPage />
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
        <Route path="suppliers/:id" element={
          <ErrorBoundary fallbackTitle="Supplier detail failed to load">
            <SupplierDetailPage />
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
    </>
  );
}
