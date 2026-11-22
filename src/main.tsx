import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  // Design-preview mock API (`npm run dev:mock`). `import.meta.env.DEV` is
  // statically false in a production build, so this branch — and the
  // `./dev/mock` chunk — is dead-code-eliminated and can never ship.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
    const { installMockApi } = await import('./dev/mock')
    installMockApi()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
