import { Spinner } from './components/ui';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './lib/auth';
import { usePath } from './lib/router';
import { ActivityPage } from './pages/ActivityPage';
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
  if (path.startsWith('/activity') && user?.role === 'admin') return <ActivityPage />;
  if (path.startsWith('/users') && user?.role === 'admin') return <UsersPage />;
  return <InvestigatePage />;
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return (
    <AppShell>
      <Routes />
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
