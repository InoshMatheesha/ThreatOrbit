import { Header } from './components/Header';
import { usePath } from './lib/router';
import { BatchesPage } from './pages/BatchesPage';
import { BatchPage } from './pages/BatchPage';
import { InvestigatePage } from './pages/InvestigatePage';
import { ProvidersPage } from './pages/ProvidersPage';

export function App() {
  const path = usePath();
  const batch = /^\/batches\/([0-9a-f-]{36})$/.exec(path);

  let page;
  if (batch) page = <BatchPage key={batch[1]} id={batch[1]!} />;
  else if (path.startsWith('/batches')) page = <BatchesPage />;
  else if (path.startsWith('/providers')) page = <ProvidersPage />;
  else page = <InvestigatePage />;

  return (
    <div className="min-h-screen">
      <Header />
      {page}
    </div>
  );
}
