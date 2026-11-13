# 0008 — Licensing model

**Decision.** Platform code is MIT (owner's choice). Each `games/<id>/` directory carries its game's license (Brogue CE: AGPL-3.0-or-later), declared in its `package.json` and `LICENSES.md`. Every distributed component (code, data, tiles, fonts, audio, docs/screenshots, third-party code, generated artifacts) is inventoried before a game becomes launchable. Copyleft source obligations are met by this public repository, which pins the exact upstream revision, plus license texts shipped beside each runtime.
**Consequences.** MIT platform code combines cleanly with GPL/AGPL game bundles. Games with unresolved asset rights (ToME, GearHead) stay on the watchlist.
