/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Upstream hijacked Tailwind's `blue-*` as its accent ramp.
                // Keeping the names (they're used across the markup) but
                // repointing them at BiKi cyan.
                blue: {
                    400: '#5ae8ff',
                    500: '#27e0ff',
                    600: '#1aa6c4',
                }
            },
            fontFamily: {
                sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
                display: ['Big Shoulders Display', 'Impact', 'sans-serif'],
            }
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
