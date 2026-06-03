import { create } from 'zustand';

export type ModuleFlags = Record<string, boolean>;

// Mirror of the backend DEFAULT_MODULES. Existing modules default on so the UI
// is unchanged until a flag is turned off; future modules default off (opt-in).
export const DEFAULT_MODULES: ModuleFlags = {
  pos:           true,
  inventory:     true,
  purchasing:    true,
  customers:     true,
  suppliers:     true,
  expenses:      true,
  reports:       true,
  warehouses:    true,
  manufacturing: false,
  hr:            false,
  multiLocation: false,
  ecommerce:     false,
  repairs:       false,
  bakery:        false,
  crm:           false,
  whatsapp:      false,
  quotations:    false,
  delivery:      false,
};

interface AppState {
  modules: ModuleFlags;
  setModules: (modules: ModuleFlags) => void;
  isModuleEnabled: (name: string) => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  modules: DEFAULT_MODULES,
  setModules: (modules) => set({ modules: { ...DEFAULT_MODULES, ...modules } }),
  // Fail open: a module is hidden only when explicitly set to false.
  isModuleEnabled: (name) => get().modules[name] !== false,
}));
