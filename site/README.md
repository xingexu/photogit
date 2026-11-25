# PhotoGit landing page

Serve this directory with `python3 -m http.server 3000 --directory site` from the repository root.

The site previews four real photographs drawn as ASCII over the full viewport. The photos are shuffled on load and crossfade every eight seconds. Moving a mouse or pen lights up characters along its path. Use the pause control in the lower-right corner to stop the rotation and trail. Reduced-motion settings show a still image without a trail.

Background photo sources ([Unsplash License](https://unsplash.com/license)):

- [Mountain lake](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- [Ocean](https://images.unsplash.com/photo-1518837695005-2083093ee35b)
- [Mountain night sky](https://images.unsplash.com/photo-1519681393784-d120267933ba)
- [Monument Valley](https://images.unsplash.com/photo-1509316785289-025f5b846b35)

For Vercel Git imports, set Root Directory to `site`, framework to Other, no build command, and output directory to `.`.
