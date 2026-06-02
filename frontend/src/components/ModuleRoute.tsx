import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useModules } from '../hooks/useModules';

interface Props {
  module: string;
  children: ReactNode;
}

/**
 * Route-level guard for a module flag. While the flags are loading, renders
 * nothing (avoids a redirect flash); once loaded, a disabled module bounces the
 * user to the dashboard.
 */
export function ModuleRoute({ module, children }: Props) {
  const { isModuleEnabled, isLoading } = useModules();

  if (isLoading) return null;
  if (!isModuleEnabled(module)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
