import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { LocaleProvider } from './i18n';
import { AppFailure } from './components/AppFailure';
import './styles.css';

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: false, refetchOnWindowFocus: false } },
});
const root = document.getElementById('root');
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
if (!root) throw new Error('Application root is missing');
createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <AppFailure>
          <RouterProvider router={router} />
        </AppFailure>
      </LocaleProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
