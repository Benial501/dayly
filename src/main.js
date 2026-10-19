import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())
  window.addEventListener('load', () => navigator.serviceWorker.register(`/sw.js?v=${__DAYLY_BUILD_ID__}`).catch(() => {}))
}
