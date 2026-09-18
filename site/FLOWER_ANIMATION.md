# Flower animation

Activate the PhotoGit title with a click, tap, Enter, or Space. Flowers cross diagonally from top left to bottom right in a single gentle wave: seven seconds of travel plus a 0.65-second launch window. The effect plays no sound.

Additional title clicks during a sweep leave the leaves running and scatter the birds again. After it finishes, activate the title again to replay. Escape, leaving the page, hiding the tab, or enabling reduced motion clears the effect. Reduced-motion users can still use every link.

Desktop uses 720 petals at 12–18 pixels; narrow screens use 360 and data saver caps either at 200. The sweep spreads leaves across nearly the full viewport using independent horizontal and vertical offsets, with crisp whole-pixel sizes and gentle rotation. The canvas is decorative and cannot intercept links or keyboard focus.

Three flocks of five larger birds cross the sky in V formations. Clicking a bird or activating the title disperses the birds for 4.8 seconds, then they return to their formation. Two discrete wing poses alternate while each body keeps its shape. Background leaves are larger and more plentiful, drifting in three depth layers with a gentle side-to-side flutter.

Run `npm run test:landing` to check the landing assets, silent interaction, motion, and cleanup. For visual review, serve `site/` and check the title at desktop and phone sizes.
