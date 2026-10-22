# Package compatibility

Current importer manifest version: 0.3.0. Locally tested wire package version: 2. The committed `contracts/import-sync/` directory is a snapshot of the producer contract, not a runtime dependency on a sibling checkout. `fixtures/compatibility/contract-snapshot.json` and `managed-snapshot.json` record each schema hash and the Toolkit version used for the fixture set.

| Fixture | Produced by | Class stable keys | Checked here |
| --- | --- | --- | --- |
| `image.json`, `ui-kit.json`, `page.json` | Toolkit 0.2.0-alpha.1 legacy `compile` | `<componentKey>/class/<name>` | image bytes verified; page roles unchanged after the kit |
| `managed-ui-kit.json`, `managed-page.json` | Toolkit 0.2.0-alpha.1 managed `build` (2026-10-09), via the Toolkit script `system/scripts/export-compatibility-fixtures.js` | `<namespace>/class/<name>`, shared by kit and page | both packages inspect; page with one embedded image; UI-kit roles unchanged, no conflicts |
| `managed-external-page.json` | Toolkit fork `gfkm/taptop-toolkit` (its 2026-10-15 state) managed `build` with `artifact add --external-css` (2026-10-15), synthetic `site-*` stylesheet | `<namespace>/class/<name>`; `externalClasses` on the wrapper | inspects; site classes never copied or synced; a project without them is refused |

Class stable keys are opaque to the importer. Receipts remain keyed by target, namespace and component key, so a page import still adopts identical UI-kit classes by name and never rewrites them.

These tests establish local compatibility for those cases only. A clean editor import, save/reload, older Toolkit versions, future package rejection and Chrome Web Store installation still require separate evidence before the public compatibility table is expanded.

## Editor on a project's own domain (2026-10-19, reworked 2026-10-22)

Taptop serves the editor not only on `*.taptop.site`: a project with its own domain can open it at
`https://<project domain>/-/cms/v1/mosaic/?…` (seen 2026-10-19; the extension showed no button there). Version 0.2.1
listed one such domain in the manifest; it showed the button there (2026-10-19). Version 0.3.0 removes it: the manifest
names no project domain, and the person allows their own domain once in the extension.

- The manifest keeps `https://*.taptop.site/-/cms/v1/mosaic/*` for `host_permissions` and `content_scripts` and
  declares `optional_host_permissions: ["https://*/*"]`: nothing beyond Taptop is granted at install.
- On a project-domain editor tab (https, default port, path `/-/cms/v1/mosaic/`, a host that is a DNS name of two or
  more labels: no IP literal, no single label such as `localhost`, no trailing dot) the toolbar popup offers
  «Разрешить на этом домене». The click calls `chrome.permissions.request` for that one origin (`https://<host>/*`),
  then the background registers `editor/auto-mount.js` for `https://<host>/-/cms/v1/mosaic/*` with
  `chrome.scripting.registerContentScripts` (id `project-editor:<host>`, `persistAcrossSessions: true`) and mounts the
  importer on the open tab. If the grant holds but the mount fails, the popup stays open with the reason; pressing the
  button again retries. The popup lists the allowed domains; «Убрать» calls `chrome.permissions.remove`. The background
  accepts «allow» and «forget» only from the popup (a message with `sender.tab` is refused).
- The background keeps the registered scripts equal to the granted single-host https origins on
  `permissions.onAdded` / `onRemoved` (a removal in Chrome's own settings included), `runtime.onStartup` and
  `runtime.onInstalled`, one `registerContentScripts` call per origin, so one rejected pattern does not block the rest.
  Because the popup may close while Chrome shows the permission prompt, `onAdded` also injects `editor/auto-mount.js`
  into editor tabs of the newly granted origin that are already open (`tabs.query` by the editor match pattern). A wildcard grant (`https://*/*` via Chrome's site access) lets the background accept any https
  editor tab but registers no script; the popup then mounts on click.
- One rule, `src/lib/editor-host.js`, decides what is an editor URL; the background (`importScripts`) and the popup
  load it. `src/lib/editor-context.js`, a second host check from the original importer that nothing loaded at runtime,
  was removed with its test. The background re-checks the grant (`permissions.contains`) before every mount and
  runtime call, so a revoked domain stops working even before its script is unregistered.
- `web_accessible_resources` (the font and the dialog sheet) match `https://*/*`, because their matches cannot follow a
  runtime grant. Both stay behind `use_dynamic_url`.
- Image upload already uses `window.location.origin`.

Unverified in a real Chrome: the permission prompt, whether the popup survives it (both paths are handled),
`tabs.query` returning the open editor tab right after the grant, the registered script surviving a browser
restart and an extension update, `onRemoved` firing for a removal in Chrome's settings, and the fonts and dialog sheet
loading on a project domain through the broader `web_accessible_resources`. The editor API on a project domain was
seen working only as far as the button appearing (2026-10-19); a full import there is still unverified.

## External classes and «use existing» (2026-10-15, local only)

A version-2 wrapper may list `externalClasses` (contract snapshot `contracts/import-sync/README.md`, same text as the Toolkit fork, branch `fork`): target-site classes that layers use by name, with no rules and no `syncPackage` entry. Package `version` stays 2, the four schema hashes are unchanged.

- One module owns the field: `src/lib/external-classes.js` (`structuralErrors`, `declaration`, `query`, `missing`). Its shape rules are the Toolkit preflight's: `{ name, collection }` items, `main` or `design`, CSS class names, sorted by name, no duplicates. The inspector adds the package cross-checks: exactly one clipboard class each, not managed, no selector entry in any of the four collections. It does not repeat the Toolkit's check that a behavior Embed targets no external class. The runtime adapter keeps its own `main` / `design` guard as the page-world boundary and checks it before reading any editor property.
- Before anything is planned, `projectClasses` (runtime adapter) is asked for every external class in its own class collection. A missing name refuses the file in review (`EXTERNAL_CLASSES_MISSING`, names listed); an editor that cannot answer refuses it as `EXTERNAL_CLASSES_UNVERIFIED`. The import session checks again before the first upload, whatever its caller planned, so nothing is uploaded, synced or pasted. The missing names travel as data (`details.missing`), not inside the message.
- A present but malformed `externalClasses` (anything `structuralErrors` rejects, a wrong collection included) is never read as "no site classes": planner and session both refuse it as `EXTERNAL_CLASSES_INVALID`, shown as a damaged file. The inspector normally rejects it first. A session loaded without `external-classes.js` stops every import as `SESSION_UNAVAILABLE` (`IMPORT_MODULE_MISSING`).
- External classes are left out of conflict detection, copies and class sync; the layers keep their names.
- A same-name project class that the file did not create is a review choice again: «Копиями» (default), «Существующие» (use existing) or «Обновить». Until this change the review applied «Обновить» without asking. «Существующие» keeps the layer on the project class, writes nothing to it, does not bind it in the receipt, and removes from the paste the selector entries that belong to that class alone (`.card`, `.card:hover`, `.card` in a media query) in all four selector collections, `main`, `design`, `cm` (states) and `animation`: the project's class wins entirely, its hover and animation included. Selectors shared with another class stay.

Unverified in a live editor:

1. That `mainClassNameCollection.map` (and `designClassNameCollection.map`) list every class of the project, including site-library classes that the open page does not use, and no deleted ones.
2. That a pasted layer whose class has no rules in the clipboard binds to the existing project class by name and leaves its rules unchanged, for both external classes and «Существующие».
3. That the paste does not merge a kept selector shared with another class (`.card .card__title`) into the project's class.
4. That with «Существующие» the block really takes the project class's states and animations: the file's own `cm` (hover, focus) and `animation` entries for that class are dropped, so a block that relied on them loses them.

## Refreshing the fixtures

There are four `managed-*` files from two sources.

**`managed-ui-kit.json`, `managed-page.json`, `managed-snapshot.json`** come from the Toolkit script `system/scripts/export-compatibility-fixtures.js`, which writes exactly these three. Run it into a new directory, review the diff, then copy the three files here in one change together with any contract update.

**`managed-external-page.json`** is not produced by that script. It is built with the Toolkit CLI from the synthetic sources committed in `fixtures/compatibility/sources/external/` (`design-system/target.css` — the stand-in for a target site's stylesheet, `input/demo/index.html`, `input/demo/styles.css`). From a shell, with `<importer>` this checkout and `<toolkit>` a Toolkit fork clone:

```sh
T=$(mktemp -d)
git -C <toolkit> archive fork | tar -x -C "$T"
cd "$T" && npm ci --ignore-scripts
npm run toolkit -- init projects/synthetic-site synthetic-site
cp -r <importer>/fixtures/compatibility/sources/external/. projects/synthetic-site/
npm run toolkit -- artifact add --project projects/synthetic-site --key pages/demo --html input/demo/index.html --css input/demo/styles.css --external-css design-system/target.css
npm run toolkit -- build --project projects/synthetic-site --artifact pages/demo
```

The build prints `jsonPath` (`output/json/pages--demo--<build id>.json` under the project); copy that file here as `managed-external-page.json`. Run on 2026-10-16, the recipe gave the committed file's `sourceRevision` (`bc408a224e7c…`), the same `externalClasses`, managed classes and selector keys. Only `exportedAt` and the generated tag and class ids differ, so a refresh shows those as a diff even when nothing else changed. To build against a newer Toolkit, replace `ab0b236` and update the row in the table above.
