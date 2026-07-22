import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { usePosStore } from '../../store/posStore';
import {
  LayoutDashboard, ShoppingCart, Package, Barcode,
  Warehouse, Building2,
  FileText, Truck, RotateCcw, Receipt,
  Users, Building,
  BarChart3, Archive, TrendingUp, Clock,
  UserCog, Settings, LogOut, ChevronLeft, ChevronRight, Upload,
  Bell, CornerUpLeft, Tag, Layers, Ruler, Percent, ClipboardCheck, Gift,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useAppSettings } from '../../context/SettingsContext';
import type { ModuleKey } from '../../config/modules';
import { alertsApi } from '../../services/alerts';
import { shiftsApi } from '../../services/shifts';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  roles?: Role[];
  module?: ModuleKey;   // hidden unless this optional feature module is enabled
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'MAIN',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/pos', label: 'POS', icon: ShoppingCart },
    ],
  },
  {
    label: 'CATALOG',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/barcodes', label: 'Barcode Labels', icon: Barcode },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { to: '/inventory', label: 'Stock Overview', icon: Warehouse, end: true },
      { to: '/warehouses', label: 'Warehouses', icon: Building2 },
      { to: '/stock-take', label: 'Stock-take', icon: ClipboardCheck, roles: ['ADMIN', 'MANAGER'], module: 'stockTake' },
      { to: '/alerts', label: 'Stock Alerts', icon: Bell },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/sales', label: 'Sales', icon: FileText },
      { to: '/purchases', label: 'Purchases', icon: Truck },
      { to: '/returns', label: 'Sale Returns', icon: RotateCcw },
      { to: '/purchase-returns', label: 'Purch. Returns', icon: CornerUpLeft },
      { to: '/promotions', label: 'Promotions', icon: Percent, roles: ['ADMIN', 'MANAGER'], module: 'promotions' },
      { to: '/expenses', label: 'Expenses', icon: Receipt },
      { to: '/shifts', label: 'POS Shifts', icon: Clock, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    label: 'PEOPLE',
    items: [
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/suppliers', label: 'Suppliers', icon: Building },
      { to: '/loyalty', label: 'Loyalty', icon: Gift, roles: ['ADMIN', 'MANAGER'], module: 'loyalty' },
    ],
  },
  {
    label: 'REPORTS',
    items: [
      { to: '/reports/sales', label: 'Sales Reports', icon: BarChart3 },
      { to: '/reports/inventory', label: 'Inventory Reports', icon: Archive },
      { to: '/reports/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/users', label: 'User Management', icon: UserCog, roles: ['ADMIN'] },
      { to: '/settings/import', label: 'Import Products', icon: Upload, roles: ['ADMIN'] },
      { to: '/settings/categories', label: 'Categories', icon: Tag, roles: ['ADMIN', 'MANAGER'] },
      { to: '/settings/brands', label: 'Brands', icon: Layers, roles: ['ADMIN', 'MANAGER'] },
      { to: '/units', label: 'Units', icon: Ruler, roles: ['ADMIN', 'MANAGER'] },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const STORAGE_KEY = 'erp_sidebar_collapsed';

export default function AppShell() {
  // ── ALL hooks must be called unconditionally before any early return ──────────
  const isFullscreen = usePosStore((s) => s.isFullscreen);
  const { user, logout } = useAuthStore();
  const { businessName, settings } = useAppSettings();
  const navigate = useNavigate();

  const { data: alertCount } = useQuery({
    queryKey: ['alert-count'],
    queryFn:  alertsApi.getCount,
    // A 60s badge refresh is acceptable; the Alerts page regenerates the canonical list on open.
    refetchInterval: 60_000,
    enabled: settings?.alertBellEnabled !== false,
  });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // v1.0.49 — open-shift warning before sign out (replaces window.alert)
  const [showShiftWarning, setShowShiftWarning] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  // ── Derived values (not hooks) ────────────────────────────────────────────────
  const userRole = user?.role as Role | undefined;

  function isVisible(item: NavItem): boolean {
    if (item.module && settings?.moduleFlags?.[item.module] !== true) return false;
    if (userRole === 'SUPER_ADMIN') return true;  // super-admin sees every role-gated item
    if (!item.roles) return true;
    return !!userRole && item.roles.includes(userRole);
  }

  async function handleLogout() {
    try {
      const result = await shiftsApi.list({ status: 'OPEN', userId: user?.id });
      if (result.data && result.data.length > 0) {
        setShowShiftWarning(true);
        return;
      }
    } catch {
      // If check fails, allow logout
    }
    logout();
    navigate('/login');
  }

  // ── Conditional returns come AFTER all hooks ──────────────────────────────────
  if (isFullscreen) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <aside
        className={`${collapsed ? 'w-16' : 'w-60'} bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-200`}
      >
        {/* Logo + toggle */}
        <div
          className={`flex items-center h-14 border-b border-slate-200 ${
            collapsed ? 'justify-center px-0' : 'px-4 justify-between'
          }`}
        >
          {!collapsed && (
            <span className="text-lg font-bold text-brand-700 truncate select-none">
              {settings?.businessName || 'BROcode ERP'}
            </span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter(isVisible);
            if (visible.length === 0) return null;
            return (
              <div key={group.label}>
                {!collapsed && (
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-2 mb-1 select-none">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {visible.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          collapsed ? 'justify-center' : ''
                        } ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                        }`
                      }
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.to === '/alerts' && alertCount && alertCount.count > 0 && (
                        <span className={`ml-auto min-w-[18px] h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 ${
                          alertCount.critical > 0 ? 'bg-red-500' : 'bg-amber-500'
                        }`}>
                          {alertCount.count > 99 ? '99+' : alertCount.count}
                        </span>
                      )}
                      {collapsed && item.to === '/alerts' && alertCount && alertCount.count > 0 && (
                        <span className={`absolute mt-[-18px] ml-[18px] min-w-[14px] h-3.5 rounded-full text-white text-[8px] font-bold flex items-center justify-center px-0.5 ${
                          alertCount.critical > 0 ? 'bg-red-500' : 'bg-amber-500'
                        }`}>
                          {alertCount.count > 9 ? '9+' : alertCount.count}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-slate-200 p-2 space-y-1">
          {!collapsed && user && (
            <div className="px-2 py-1 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{user.fullName}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
              {/* Notification bell */}
              {settings?.alertBellEnabled !== false && (
                <button
                  onClick={() => navigate('/alerts')}
                  title="Stock Alerts"
                  className="relative p-1.5 rounded-lg hover:bg-slate-100 transition shrink-0 ml-1"
                >
                  <Bell className="w-4 h-4 text-slate-500" />
                  {alertCount && alertCount.count > 0 && (
                    <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-white text-[9px] font-bold flex items-center justify-center px-0.5 ${
                      alertCount.critical > 0 ? 'bg-red-500' : 'bg-amber-500'
                    }`}>
                      {alertCount.count > 99 ? '99+' : alertCount.count}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          {collapsed && settings?.alertBellEnabled !== false && (
            <button
              onClick={() => navigate('/alerts')}
              title="Stock Alerts"
              className="relative flex w-full items-center justify-center p-2 rounded-lg hover:bg-slate-100 transition"
            >
              <Bell className="w-4 h-4 text-slate-500" />
              {alertCount && alertCount.count > 0 && (
                <span className={`absolute top-0.5 right-0.5 min-w-[14px] h-3.5 rounded-full text-white text-[8px] font-bold flex items-center justify-center px-0.5 ${
                  alertCount.critical > 0 ? 'bg-red-500' : 'bg-amber-500'
                }`}>
                  {alertCount.count > 9 ? '9+' : alertCount.count}
                </span>
              )}
            </button>
          )}
          <button
            onClick={handleLogout}
            title="Sign out"
            className={`flex w-full items-center gap-2 px-2 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto erp-content">
        <Outlet />
      </main>

      {/* v1.0.49 — open-shift warning before sign out */}
      {showShiftWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">
                Open Shift Found
              </h3>
              <p className="text-sm text-gray-600">
                You have an open POS shift. Please go to POS and close your shift before signing out.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowShiftWarning(false);
                  navigate('/pos');
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl text-sm transition"
              >
                Go to POS
              </button>
              <button
                onClick={() => setShowShiftWarning(false)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-sm transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
