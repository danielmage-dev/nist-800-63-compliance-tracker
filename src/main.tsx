import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import SectionRoute from './components/spec/SectionRoute';
import Dashboard from './components/dashboard/Dashboard';
import RevIndexRedirect from './components/RevIndexRedirect';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const router = createBrowserRouter([
  // Resolve the default revision, then redirect into it.
  { index: true, element: <RevIndexRedirect /> },
  {
    path: '/rev/:rev',
    element: <App />,
    children: [
      { index: true, element: <RevIndexRedirect /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'section/:number', element: <SectionRoute /> },
      { path: 'section/:number/req/:reqId', element: <SectionRoute /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
