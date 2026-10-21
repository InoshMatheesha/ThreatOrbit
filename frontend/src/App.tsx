import { Spinner } from './components/ui';
import { Header } from './components/Header';
import { AuthProvider, useAuth } from './lib/auth';
import { usePath } from './lib/router';
import { BatchesPage } from './pages/BatchesPage';
import { BatchPage } from './pages/BatchPage';
import { InvestigatePage } from './pages/InvestigatePage';
import { LoginPage } from './pages/LoginPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { UsersPage } from './pages/UsersPage';

function Routes() {
  const path = usePath();
  const { user } = useAuth();
  const batch = /^\/batches\/([0-9a-f-]{36})$/.exec(path);

  if (batch) return <BatchPage key={batch[1]} id={batch[1]!} />;
  if (path.startsWith('/batches')) return <BatchesPage />;
  if (path.startsWith('/providers')) return <ProvidersPage />;
  if (path.startsWith('/users') && user?.role === 'admin') return <UsersPage />;
  return <InvestigatePage />;
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-xs text-slate-500">
        <Spinner />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <div className="min-h-screen">
      <Header />
      <Routes />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
