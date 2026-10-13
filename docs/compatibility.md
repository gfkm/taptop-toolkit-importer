# Package compatibility

Current importer manifest version: 0.2.0. Locally tested wire package version: 2. The committed `contracts/import-sync/` directory is a snapshot of the producer contract, not a runtime dependency on a sibling checkout. `fixtures/compatibility/contract-snapshot.json` and `managed-snapshot.json` record each schema hash and the Toolkit version used for the fixture set.

| Fixture | Produced by | Class stable keys | Checked here |
| --- | --- | --- | --- |
| `image.json`, `ui-kit.json`, `page.json` | Toolkit 0.2.0-alpha.1 legacy `compile` | `<componentKey>/class/<name>` | image bytes verified; page roles unchanged after the kit |
| `managed-ui-kit.json`, `managed-page.json` | Toolkit 0.2.0-alpha.1 managed `build` (2026-10-09), via the Toolkit script `system/scripts/export-compatibility-fixtures.js` | `<namespace>/class/<name>`, shared by kit and page | both packages inspect; page with one embedded image; UI-kit roles unchanged, no conflicts |

Class stable keys are opaque to the importer. Receipts remain keyed by target, namespace and component key, so a page import still adopts identical UI-kit classes by name and never rewrites them.

These tests establish local compatibility for those cases only. A clean editor import, save/reload, older Toolkit versions, future package rejection and Chrome Web Store installation still require separate evidence before the public compatibility table is expanded.

To refresh the managed fixtures, run the Toolkit script into a new directory, review the diff, then copy the three `managed-*` files here in one change together with any contract update.
