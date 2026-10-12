import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as CapacitorApp } from '@capacitor/app'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { reportCriticalError } from './lib/errorReporting'
import './styles.css'
import './functional.css'
import './customer.css'

window.addEventListener('error', (event) => {
  reportCriticalError(event.error || event.message, {
    feature: 'frontend',
    operation: 'window-error',
  })
})

window.addEventListener('unhandledrejection', (event) => {
  reportCriticalError(event.reason, {
    feature: 'frontend',
    operation: 'unhandled-rejection',
  })
})

CapacitorApp.addListener('appUrlOpen', ({ url }) => {
  try {
    const parsed = new URL(url)

    if (parsed.pathname.startsWith('/b/')) {
      window.history.pushState({}, '', `${parsed.pathname}${parsed.search}${parsed.hash}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  } catch {
    // Ignore invalid deep links
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) =>
      reportCriticalError(error, {
        feature: 'pwa',
        operation: 'service-worker-registration',
      })
    )
  })
}
