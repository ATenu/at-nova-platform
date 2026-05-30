import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { env } from './lib/env';
import './styles/global.css';
import './styles/layout.css';
import './styles/chat.css';

/**
 * Bootstrap. In local mock mode we start the in-browser API (MSW) before
 * rendering so the very first requests are intercepted. The mock worker is
 * dynamically imported so it is tree-shaken out of production builds.
 */
async function bootstrap(): Promise<void> {
  if (env.useMocks) {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found.');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
