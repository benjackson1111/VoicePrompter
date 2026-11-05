import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://bikistudios.com/prompter/
const BASE = '/prompter/'

export default defineConfig({
    base: BASE,
    build: {
        // Emit straight into the website tree. Everything under
        // "2026 website" is uploadable as-is; this project (and its
        // node_modules) deliberately lives outside it.
        outDir: '../2026 website/prompter',
        emptyOutDir: true
    },
    plugins: [
        VitePWA({
            // No offline cache. Cloudflare cached sw.js (for a year), so
            // devices that had used the app kept running an OLD build and never
            // learned a new one existed. selfDestroying ships a sw.js that
            // unregisters itself and deletes the old offline copy; after that
            // every visit loads the current upload. The manifest (Add to Home
            // Screen) is unaffected.
            selfDestroying: true,
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: 'BiKi Prompter',
                short_name: 'BiKi Prompter',
                description: 'Voice-activated teleprompter that follows your script as you speak.',
                theme_color: '#08090c',
                background_color: '#08090c',
                display: 'standalone',
                start_url: BASE,
                scope: BASE,
                icons: [
                    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
                ]
            }
        })
    ]
})
