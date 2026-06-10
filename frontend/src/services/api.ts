/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// v1.0.44 — guards against multiple parallel 401s scheduling several logout
// timers / dispatching several banners. Reset AFTER logout() runs (see below).
let logoutScheduled = false;

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.code === 'ECONNABORTED') {
      err.message = 'Request timed out. Please try again.';
    }
    if (err.response?.status === 401) {
      // v1.0.44 — graceful logout: warn the user for 5s (via the auth:expired
      // event, handled in App.tsx) before clearing the session, so unsaved form
      // data isn't yanked away without warning.
      if (logoutScheduled) return Promise.reject(err);
      logoutScheduled = true;

      window.dispatchEvent(
        new CustomEvent('auth:expired', { detail: { message: 'Session expired' } }),
      );

      setTimeout(() => {
        useAuthStore.getState().logout();
        logoutScheduled = false; // reset AFTER logout, not before
      }, 5000);

      return Promise.reject(err);
    }
    return Promise.reject(err);
  }
);
