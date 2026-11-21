import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './motion.css'
import './detail.css'
import App from './App.jsx'
import LedgerPanel from './components/LedgerPanel.jsx'
import { confirmPurchase } from './lib/ledger.js'
import { installButtonPressFeedback } from './lib/buttonPressFeedback.js'

const root = document.getElementById('root')
const disposePressFeedback = installButtonPressFeedback(root)
if (import.meta.hot) import.meta.hot.dispose(disposePressFeedback)

createRoot(root).render(
  <StrictMode>
    <App LedgerPanel={LedgerPanel} confirmPurchase={confirmPurchase} />
  </StrictMode>,
)
