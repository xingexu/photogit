# PhotoGit landing page

Serve this directory with `python3 -m http.server 3000 --directory site` from the repository root.

The History and Branches screenshots settle into place on load. Move a mouse over the screenshots to tilt the scene. The hero and social preview use a cropped native History capture from `artifacts/editorial-ui-20260905/native-dark-history-753x800.png`.

The full-screen background draws ASCII characters from four locally bundled, grayscale photographs. It shuffles them when the page loads, then crossfades to the next photo every eight seconds. Moving a mouse or pen lights up characters along its path. The background can be paused, and reduced-motion settings keep one photo on screen and disable the trail, entrance animations, and tilt.

Background photo sources ([Unsplash License](https://unsplash.com/license)):

- [Mountain lake](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- [Ocean](https://images.unsplash.com/photo-1518837695005-2083093ee35b)
- [Mountain night sky](https://images.unsplash.com/photo-1519681393784-d120267933ba)
- [Monument Valley](https://images.unsplash.com/photo-1509316785289-025f5b846b35)

For Vercel Git imports, set Root Directory to `site`, framework to Other, no build command, and output directory to `.`.
