import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { configApi } from '../services/config';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';

/**
 * Fetches the client's module flags, caches them in the app store, and exposes
 * isModuleEnabled for gating sidebar items and routes. Only runs when logged in.
 * TanStack Query v5 has no onSuccess, so the store sync happens in an effect.
 */
export function useModules() {
  const { modules, setModules, isModuleEnabled } = useAppStore();
  const token = useAuthStore((s) => s.accessToken);

  const { data, isLoading } = useQuery({
    queryKey: ['config', 'modules'],
    queryFn:  configApi.getModules,
    enabled:  !!token,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  useEffect(() => {
    if (data) setModules(data);
  }, [data, setModules]);

  return { modules, isModuleEnabled, isLoading };
}
