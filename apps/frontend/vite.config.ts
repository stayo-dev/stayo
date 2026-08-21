import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// StayO requires an explicit dev-proxy target whenever `vite dev` actually
// starts the dev server — no hardcoded host, no silent fallback (mirrors the
// same rule enforced in src/lib/api-client.ts for the browser-side API base
// URL). Only enforced for the dev server, not `vite build`, since production
// builds never read this value.
//
// Takes the loaded-env object rather than reading `process.env` directly —
// Vite does NOT populate `process.env` from `.env`/`.env.local` files inside
// the config function itself (that only happens for `import.meta.env` in
// app code); the config has to call `loadEnv()` explicitly and read from
// its return value, or a real `.env` file with this var set would still
// fail here even though it's exactly what `.env.example` tells you to do.
function requireApiProxyTarget(env: Record<string, string>) {
  const target = env.HMS_API_PROXY_TARGET
  if (!target || !target.trim()) {
    throw new Error(
      'HMS_API_PROXY_TARGET is not set. StayO requires an explicit dev-proxy target — ' +
        'see apps/frontend/.env.example.',
    )
  }
  return target
}

export default defineConfig(({ command, mode }) => {
  // Third arg '' loads every var regardless of a VITE_ prefix — needed since
  // HMS_API_PROXY_TARGET is deliberately unprefixed (it's a build-time-only
  // config value, never shipped to the browser bundle like VITE_* vars are).
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      figmaAssetResolver(),
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@lib': path.resolve(__dirname, './src/lib'),
        '@features': path.resolve(__dirname, './src/features'),
        '@domains': path.resolve(__dirname, './src/domains'),
        '@platforms': path.resolve(__dirname, './src/platforms'),
        '@shared': path.resolve(__dirname, './src/shared'),
        '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
        '@context': path.resolve(__dirname, './src/context'),
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: command === 'serve' ? requireApiProxyTarget(env) : '',
          changeOrigin: true,
        },
        /**
         * The share preview (`/h/:slug`). In production this is a rewrite in
         * `vercel.json`; the dev server needs the same mapping or a share link
         * copied while developing 404s against the SPA instead of rendering
         * the preview page. Same target, same path rewrite as the deployed
         * rule — one place to change if the backend path ever moves.
         */
        '/h/': {
          target: command === 'serve' ? requireApiProxyTarget(env) : '',
          changeOrigin: true,
          rewrite: (requestPath: string) =>
            requestPath.replace(/^\/h\//, '/api/discover/share/'),
        },
      },
    },
    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
