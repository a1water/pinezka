import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { placeStore } from './data/place-store.ts'
import './index.css'
import { startRouter } from './router.ts'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

// Started here and not in a component: under StrictMode a component's
// effects run twice, and the data should be read only once.
startRouter()
void placeStore.load()

// The page can be closed at any moment after it is hidden, so that is the
// last sure chance to send what was typed. Coming back is the moment to pick
// up what another open copy of the app saved meanwhile, and to try a failed
// save again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void placeStore.flush()
  else void placeStore.resume()
})
window.addEventListener('pagehide', () => void placeStore.flush())
// A page brought back from the browser's back-forward cache was not hidden
// in a way the handler above saw, but its data may be just as old.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void placeStore.resume()
})

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
