import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as CapacitorApp } from '@capacitor/app'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'
import './functional.css'
import './customer.css'
import './dashboard.css'

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
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
