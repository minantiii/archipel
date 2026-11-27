import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { aplicarTema, temaSalvo } from './lib/tema'

// Antes do primeiro quadro: assim o app já abre com o tema certo, sem piscar o padrão.
aplicarTema(temaSalvo())

const raiz = document.getElementById('root')
if (!raiz) throw new Error('Elemento #root não encontrado no index.html')

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>
)
