import { AppProviders } from './providers';
import { AppRouter } from './router';

export function App() {
  return (
    <>
      <div className="app-bg" aria-hidden />
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </>
  );
}
