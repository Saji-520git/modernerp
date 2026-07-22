import { useAppSettings } from '../context/SettingsContext';
import { useAuthStore } from '../store/authStore';
import { isSuperAdmin } from '../utils/roles';
import type { ModuleKey } from '../config/modules';

/**
 * Whether an optional feature module is enabled for this business.
 * Default (missing flag) = off. Super-admin always sees/uses every module
 * (they configure each area per client). Used to gate nav, routes and hooks.
 */
export function useModule(key: ModuleKey): boolean {
  const { settings } = useAppSettings();
  const user = useAuthStore((s) => s.user);
  if (isSuperAdmin(user?.role)) return true;
  return settings?.moduleFlags?.[key] === true;
}
