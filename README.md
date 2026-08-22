# BiKi Prompter

Voice-activated teleprompter for bikistudios.com — follows your script as you
speak, and keeps up when you go off book.

Served at `https://bikistudios.com/prompter/`.

## Origin & licence

Forked from [kosuvorov/VoicePrompter](https://github.com/kosuvorov/VoicePrompter),
which is licensed **GPL-3.0**. That licence carries over to this copy, and two
things follow from it:

- `LICENSE` stays in the tree, and upstream's copyright notices stay intact.
- Shipping the built JS to browsers counts as conveying the program, so our
  modified source has to be offered to users under GPL-3.0 too. Publishing this
  directory as a public repo and linking it from the app footer satisfies that.

Using it commercially is fine; making it closed-source is not.

## What was changed from upstream

- Trimmed to the app only — dropped the ~40 SEO blog posts and the
  mac/ios/ipad/android/web marketing landing pages.
- Removed three third-party trackers (Umami analytics, Ansvisor, and a
  session recorder that captured DOM interactions).
- Rebased onto `/prompter/`: Vite `base`, PWA `start_url` and `scope`.
- Rebranded titles, headings and OG/canonical metadata.
- Fixed an upstream crash: `dockPinned` was a `let` declared below the hoisted
  `pinDockToVisualViewport()`, so the `boot()` call during module eval hit its
  temporal dead zone and aborted `boot()` partway. Flag now declared above its
  first caller.

## Develop

    npm install
    npm run dev      # http://localhost:5180/prompter/
    npm run build    # -> dist/

Deploy by copying `dist/` to `/prompter/` on the web host.

## Layout

`src/speech.ts` — recognition + matching your spoken words to the script.
`src/autoscroll.ts` — scroll behaviour. `src/render.ts` — script painting and
highlight. `src/video.ts` — camera + recording. `src/main.ts` — wiring.
