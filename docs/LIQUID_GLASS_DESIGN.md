# Liquid glass reference design

The September 22 reference uses white lettering in both themes: pearl-blue frosted glass for Light, and deep navy smoked glass for Dark. A shared abstract wallpaper supplies the blurred reflections behind translucent cards. The floating panel opens at 1100 × 780 with navigation, changes and preview/save columns. Docked panels retain the compact layout.

The background is painted directly on the panel root. Its blur is baked into the bitmap, so the native UXP renderer does not depend on CSS backdrop-filter or a negative stacking layer. Actual document previews remain labeled as the latest saved version. Photoshop supplies its own window chrome; this is a functional adaptation of the reference, not a pixel-identical bitmap replica.

## Background asset

Saved asset: [`apps/photoshop-plugin/assets/liquid-glass-backdrop.png`](../apps/photoshop-plugin/assets/liquid-glass-backdrop.png), 1536 × 1024 PNG. Generated using the built-in image generation tool, then copied into the project. No document artwork is included in the background.

Final generation prompt:

> Create a production background bitmap asset only for a liquid-glass desktop software interface, landscape 3:2 aspect ratio, ideally 1536x1024. No interface, no panels, no text, no typography, no logos, no window frame, no border. The entire image is a deliberately out-of-focus abstract 3D glass/satin sculpture: broad flowing diagonal ribbons of cobalt blue and smoky slate, deep near-black navy negative spaces, a few luminous pearl-lavender highlights and small warm champagne reflected light at the left edge and lower right edge. Composition: soft bright blue light across the upper-left and top middle, broad deep midnight ribbon sweeping from top right diagonally down toward lower center, blue ribbon along lower edge, blurred pearl and champagne reflections at far left and right edges. Overall cool blue/charcoal, sophisticated, photographic reflections rather than flat vector gradients; no sharp outlines, no speckle, no grain, no bokeh dots. All details already strongly optically defocused with roughly 25px soft blur, beautiful broad shapes still discernible under translucent frosted UI panels. Keep the central area dark and calm for white UI text. This will be placed behind actual functional translucent interface cards, so output ONLY the abstract blurred wallpaper filling the full canvas.

Native and simulated verification evidence is recorded in [the acceptance report](ACCEPTANCE_REPORT.md). Native screenshots contain real document artwork and remain local, outside the repository.
