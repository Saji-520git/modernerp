import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { Clock, Loader2 } from 'lucide-react';
import { api } from './services/api';
import ErrorBoundary from './components/common/ErrorBoundary';
import { ModuleRoute } from './components/ModuleRoute';
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
import SuperAdminPage from './pages/super-admin/SuperAdminPage';
import StaffPage from './pages/hr/StaffPage';
import AttendancePage from './pages/hr/AttendancePage';
import SalaryPage from './pages/hr/SalaryPage';
import LeavePage from './pages/hr/LeavePage';
import HRReportsPage from './pages/hr/HRReportsPage';
import CRMDashboardPage from './pages/crm/CRMDashboardPage';
import LoyaltySettingsPage from './pages/crm/LoyaltySettingsPage';
import PriceTiersPage from './pages/crm/PriceTiersPage';
import WhatsAppSettingsPage from './pages/whatsapp/WhatsAppSettingsPage';
import WhatsAppBroadcastPage from './pages/whatsapp/WhatsAppBroadcastPage';
import QuotationsPage from './pages/quotations/QuotationsPage';
import QuotationFormPage from './pages/quotations/QuotationFormPage';
import QuotationDetailPage from './pages/quotations/QuotationDetailPage';
import DeliveryPage from './pages/delivery/DeliveryPage';
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

  useEffect(() => {
    let cancelled = false;
    const token = useAuthStore.getState().accessToken;
    if (!token) { setChecking(false); return; }
    api.get('/auth/me')
      .catch(() => { /* interceptor handles 401 logout */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
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
          <ModuleRoute module="pos">
            <ErrorBoundary fallbackTitle="POS failed to load">
              <POSPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* CATALOG */}
        <Route path="products" element={
          <ErrorBoundary fallbackTitle="Products page failed to load">
            <ProductsPage />
          </ErrorBoundary>
        } />
        <Route path="barcodes" element={
          <ModuleRoute module="inventory">
            <ErrorBoundary fallbackTitle="Barcode Labels failed to load">
              <BarcodeLabelsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* INVENTORY */}
        <Route path="inventory" element={
          <ModuleRoute module="inventory">
            <ErrorBoundary fallbackTitle="Inventory page failed to load">
              <InventoryPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="inventory/transfers"   element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
        <Route path="inventory/adjustments" element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
        <Route path="inventory/movements"   element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
        <Route path="warehouses" element={
          <ModuleRoute module="warehouses">
            <ErrorBoundary fallbackTitle="Warehouses page failed to load">
              <WarehousesPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* OPERATIONS */}
        <Route path="sales" element={
          <ErrorBoundary fallbackTitle="Sales page failed to load">
            <SalesPage />
          </ErrorBoundary>
        } />
        <Route path="purchases" element={
          <ModuleRoute module="purchasing">
            <ErrorBoundary fallbackTitle="Purchases page failed to load">
              <PurchasesPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="returns"  element={
          <ErrorBoundary fallbackTitle="Returns page failed to load">
            <ReturnsPage />
          </ErrorBoundary>
        } />
        <Route path="purchase-returns" element={
          <ModuleRoute module="purchasing">
            <ErrorBoundary fallbackTitle="Purchase Returns page failed to load">
              <PurchaseReturnsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="expenses" element={
          <ModuleRoute module="expenses">
            <ErrorBoundary fallbackTitle="Expenses page failed to load">
              <ExpensesPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="shifts" element={
          <ErrorBoundary fallbackTitle="POS Shifts failed to load">
            <ShiftsPage />
          </ErrorBoundary>
        } />
        <Route path="alerts" element={
          <ModuleRoute module="inventory">
            <ErrorBoundary fallbackTitle="Stock Alerts failed to load">
              <AlertsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* QUOTATIONS — /new must precede /:id */}
        <Route path="quotations" element={
          <ModuleRoute module="quotations">
            <ErrorBoundary fallbackTitle="Quotations page failed to load">
              <QuotationsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="quotations/new" element={
          <ModuleRoute module="quotations">
            <ErrorBoundary fallbackTitle="Quotation form failed to load">
              <QuotationFormPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="quotations/:id/edit" element={
          <ModuleRoute module="quotations">
            <ErrorBoundary fallbackTitle="Quotation form failed to load">
              <QuotationFormPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="quotations/:id" element={
          <ModuleRoute module="quotations">
            <ErrorBoundary fallbackTitle="Quotation detail failed to load">
              <QuotationDetailPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* DELIVERY */}
        <Route path="delivery" element={
          <ModuleRoute module="delivery">
            <ErrorBoundary fallbackTitle="Delivery page failed to load">
              <DeliveryPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* PEOPLE */}
        <Route path="customers" element={
          <ModuleRoute module="customers">
            <ErrorBoundary fallbackTitle="Customers page failed to load">
              <CustomersPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="customers/:id" element={
          <ModuleRoute module="customers">
            <ErrorBoundary fallbackTitle="Customer detail failed to load">
              <CustomerDetailPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="suppliers" element={
          <ModuleRoute module="suppliers">
            <ErrorBoundary fallbackTitle="Suppliers page failed to load">
              <SuppliersPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="suppliers/:id" element={
          <ModuleRoute module="suppliers">
            <ErrorBoundary fallbackTitle="Supplier detail failed to load">
              <SupplierDetailPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="contacts" element={<Navigate to="/suppliers" replace />} />

        {/* HR */}
        <Route path="hr" element={<Navigate to="/hr/staff" replace />} />
        <Route path="hr/staff" element={
          <ModuleRoute module="hr">
            <ErrorBoundary fallbackTitle="Staff page failed to load">
              <StaffPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="hr/attendance" element={
          <ModuleRoute module="hr">
            <ErrorBoundary fallbackTitle="Attendance page failed to load">
              <AttendancePage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="hr/salary" element={
          <ModuleRoute module="hr">
            <ErrorBoundary fallbackTitle="Salary page failed to load">
              <SalaryPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="hr/leave" element={
          <ModuleRoute module="hr">
            <ErrorBoundary fallbackTitle="Leave page failed to load">
              <LeavePage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="hr/reports" element={
          <ModuleRoute module="hr">
            <ErrorBoundary fallbackTitle="HR Reports failed to load">
              <HRReportsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* CRM */}
        <Route path="crm" element={
          <ModuleRoute module="crm">
            <ErrorBoundary fallbackTitle="Customer Intelligence failed to load">
              <CRMDashboardPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="crm/loyalty" element={
          <ModuleRoute module="crm">
            <ErrorBoundary fallbackTitle="Loyalty Settings failed to load">
              <LoyaltySettingsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="crm/tiers" element={
          <ModuleRoute module="crm">
            <ErrorBoundary fallbackTitle="Price Tiers failed to load">
              <PriceTiersPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* WHATSAPP */}
        <Route path="whatsapp/settings" element={
          <ModuleRoute module="whatsapp">
            <ErrorBoundary fallbackTitle="WhatsApp Settings failed to load">
              <WhatsAppSettingsPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />
        <Route path="whatsapp/broadcast" element={
          <ModuleRoute module="whatsapp">
            <ErrorBoundary fallbackTitle="Broadcast failed to load">
              <WhatsAppBroadcastPage />
            </ErrorBoundary>
          </ModuleRoute>
        } />

        {/* REPORTS */}
        <Route path="reports" element={<ModuleRoute module="reports"><Outlet /></ModuleRoute>}>
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

        {/* BROcode Solutions staff only — not linked anywhere in the UI.
            Authorization is enforced by the backend super-admin check. */}
        <Route path="super-admin" element={
          <ErrorBoundary fallbackTitle="Super Admin failed to load">
            <SuperAdminPage />
          </ErrorBoundary>
        } />

        {/* Legacy */}
        <Route path="units" element={<UnitsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
