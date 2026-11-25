# PhotoGit landing page

Serve this directory with `python3 -m http.server 3000 --directory site` from the repository root.

The site picks one of four nature photographs on each load and draws it as full-screen color ASCII. Moving a mouse or pen lights up characters along its path and tilts the PhotoGit title on hover. Reduced-motion settings disable the trail and tilt.

Background photo sources ([Unsplash License](https://unsplash.com/license)):

- [Mountain lake](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- [Ocean](https://images.unsplash.com/photo-1518837695005-2083093ee35b)
- [Mountain night sky](https://images.unsplash.com/photo-1519681393784-d120267933ba)
- [Monument Valley](https://images.unsplash.com/photo-1509316785289-025f5b846b35)

For Vercel Git imports, set Root Directory to `site`, framework to Other, no build command, and output directory to `.`.
