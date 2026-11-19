# PhotoGit landing page

Serve this directory with `python3 -m http.server 3000 --directory site` from the repository root.

Hover over the Photoshop workspace with a mouse to tilt the scene. The workspace, floating tools, and rest of the page use CSS perspective and layered surfaces. The artwork is a local WebP.

Click or tap the PhotoGit label, or activate it with Enter or Space, for a petal burst and bird reaction. Escape dismisses it. The footer sound toggle remembers your preference. Reduced-motion settings disable the tilt, floating animation, and burst.

The bird chirp plays after a user gesture and respects browser and device settings.

For Vercel Git imports, set Root Directory to `site`, framework to Other, no build command, and output directory to `.`.
