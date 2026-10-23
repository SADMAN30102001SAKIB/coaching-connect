import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LocaleProvider } from './i18n';
import { ThemeProvider } from './theme';
import { AppFailure } from './components/AppFailure';
import { retryRead } from './api';
import './styles.css';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      retry: retryRead,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    },
    mutations: { retry: false, networkMode: 'always' },
  },
});
const root = document.getElementById('root');
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
if (!root) throw new Error('Application root is missing');
createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ThemeProvider>
          <AppFailure>
            <RouterProvider router={router} />
          </AppFailure>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
