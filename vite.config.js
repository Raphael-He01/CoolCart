import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { handleProductImport } from './api/import-product.js'
import { handlePurchaseReview } from './api/purchase-review.js'

export default defineConfig(({ mode }) => {
  const { DEEPSEEK_API_KEY } = loadEnv(mode, process.cwd(), 'DEEPSEEK_API_KEY')
  function mountApi(server) {
    server.middlewares.use('/api/import-product', (req, res) => {
      void handleProductImport(req, res, DEEPSEEK_API_KEY)
    })
    server.middlewares.use('/api/purchase-review', (req, res) => {
      void handlePurchaseReview(req, res, DEEPSEEK_API_KEY)
    })
  }
  return {
    plugins: [
      react(),
      {
        name: 'cool-cart-api',
        configureServer: mountApi,
        configurePreviewServer: mountApi,
      },
    ],
  }
})
