# Brand

- `emblem.png`: the round emblem (a hero stepping out of an archway between open books). It is the source of every icon: the favicons, the PWA manifest's icons, the iOS home screen icon and the header's mark.
- `lockup.png`: the emblem with the ROGUE ARCHIVE wordmark, for the README and other places where an image stands on its own.

The icons in `apps/web/public/icons` are generated from the emblem with `python3 tools/brand-icons.py` (needs Pillow). It records how they are made: transparent round icons; maskable icons with all of the art inside the safe zone; an opaque iOS icon. It also makes the light theme's header mark: no navy disc (transparent), the cream parts redrawn in the site's ink, teal and amber kept, cropped to the art. Run it again after changing the emblem. The header's wordmark is set in the site's own fonts after the lockup: ROGUE in the display serif, ARCHIVE in spaced amber capitals.
