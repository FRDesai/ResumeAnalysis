import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth';
import { Layout } from './components/Layout';
import './index.css';
import { EvalsPage } from './pages/Evals';
import { HistoryPage } from './pages/History';
import { LoginPage } from './pages/Login';
import { ReportPage } from './pages/Report';
import { RunProgressPage } from './pages/RunProgress';
import { UploadPage } from './pages/Upload';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <UploadPage /> },
      { path: '/runs/:runId', element: <RunProgressPage /> },
      { path: '/reports/:runId', element: <ReportPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/evals', element: <EvalsPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '*', element: <p className="text-sm text-ink-2">Page not found.</p> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
