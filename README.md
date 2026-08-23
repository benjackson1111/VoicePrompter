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
### Two upstream bugs fixed

Both of these are faults in upstream's code, not things we introduced. They'd
be worth offering back to kosuvorov as pull requests.

**`boot()` aborted on every page load.** `dockPinned` was a `let` declared
below the hoisted `pinDockToVisualViewport()`, so the `boot()` call during
module eval hit its temporal dead zone and threw. That killed the rest of
`boot()`, including the history re-render the comment above it was added to
guarantee. Flag now declared above its first caller.

**A repeated word dragged the cursor down the script.** Reading a script where
the same word recurs across nearby sentences, the highlight would skip the
occurrence being read and land on a later one. The cause is duplicate
processing: recognition emits a result while a phrase is interim and again once
it finalises, so identical audio arrives twice, and by the second pass the
cursor has moved past the correct match. Fixed by recording the run of words
each match consumed and ignoring an identical repeat. Simulated over five
repetition-heavy scripts at 1-3 results per word, divergences went from 62 to 0.

Note this is simulated, not measured against real speech.

## Layout

This project lives *outside* the website folder on purpose. Everything under
`website/2026 website/` is uploadable to the server as-is; this directory holds
the source and a 138 MB `node_modules` that the server must never see (and whose
symlinks FTP clients can't transfer anyway).

    website/
      prompter-src/          <- this project (source, node_modules)
      2026 website/
        prompter/            <- build output ONLY. 304 KB, no symlinks.

## Develop

    cd "website/prompter-src"
    npm install
    npm run dev              # http://localhost:5173/prompter/
    npm run build            # writes ../2026 website/prompter/

## Deploy

`npm run build`, then upload `2026 website/prompter/` with the rest of the site.
No separate step, no exclusions to remember in Transmit.

Note that `build` empties `2026 website/prompter/` first, so don't hand-edit
anything in there - it gets wiped on the next build.

## Layout

`src/speech.ts` — recognition + matching your spoken words to the script.
`src/autoscroll.ts` — scroll behaviour. `src/render.ts` — script painting and
highlight. `src/video.ts` — camera + recording. `src/main.ts` — wiring.
