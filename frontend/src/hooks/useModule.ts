import { useAppSettings } from '../context/SettingsContext';
import type { ModuleKey } from '../config/modules';

/**
 * Whether an optional feature module is enabled for this business.
 * Default (missing flag) = off. Use to gate nav items, routes and POS hooks.
 */
export function useModule(key: ModuleKey): boolean {
  const { settings } = useAppSettings();
  return settings?.moduleFlags?.[key] === true;
}
