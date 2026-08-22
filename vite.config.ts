import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://bikistudios.com/prompter/
const BASE = '/prompter/'

export default defineConfig({
    base: BASE,
    plugins: [
        VitePWA({
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
