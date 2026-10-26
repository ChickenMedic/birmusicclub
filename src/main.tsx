import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import App from './App.tsx';
import './styles.css';
import { startFaviconCycle } from './favicon';

startFaviconCycle();

const root = createRoot(document.getElementById('root')!);

// amplify_outputs.json is produced by the backend deploy and copied into public/ at build time.
fetch('/amplify_outputs.json')
  .then((res) => {
    if (!res.ok) throw new Error(`amplify_outputs.json returned HTTP ${res.status}`);
    return res.json();
  })
  .then((outputs) => {
    Amplify.configure(outputs);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    console.error(err);
    root.render(<p className="boot-error">The site could not load its configuration. Try refreshing.</p>);
  });
