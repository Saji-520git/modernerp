import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emitToast } from './lib/toast-bus';
import GlobalToast from './components/common/GlobalToast';
import ErrorBoundary from './components/common/ErrorBoundary';
import { SettingsProvider } from './context/SettingsContext';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    // Fallback error surfacing for mutations that don't define their own
    // onError. This is a DEFAULT, not a cache-level subscriber — any
    // useMutation call with its own onError overrides this entirely for
    // that instance, so already-handled flows (confirmSale, Units
    // create/update/delete, etc.) are unaffected. Do not change to
    // MutationCache — that fires unconditionally and would double-toast
    // already-handled mutations.
    mutations: {
      onError: (error: any) => {
        emitToast(
          error?.response?.data?.message ?? 'Something went wrong. Please try again.',
          false
        );
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Application failed to start">
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <GlobalToast />
          <SettingsProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </SettingsProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
