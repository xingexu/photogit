# PhotoGit landing page

Serve this directory with `python3 -m http.server 3000 --directory site` from the repository root.

Click or tap PHOTOGIT, or activate it with Enter or Space, for a leaf burst and whoosh. Escape dismisses it. The footer sound toggle remembers your preference. Reduced-motion settings disable the burst and background motion.

The initial title reveal takes 1.2 seconds. The call to action fades in during the reveal. The completed title becomes plain text and stays visible.

Audio is an original generated mono 16-bit PCM WAV. Regenerate it with `python3 scripts/generate-leaf-whoosh.py`. Playback requires a user gesture and respects browser and device settings.

For Vercel Git imports, set Root Directory to `site`, framework to Other, no build command, and output directory to `.`.
