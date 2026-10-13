# Provenance (importer)

Recorded 2026-10-09, decisions added 2026-10-13. The owner decided: the importer and its class-sync code are the owner's own work, the owner holds the rights, and both products are published under the MIT License.

| Material | Origin | Status |
| --- | --- | --- |
| `src/lib/class-sync.js`, `class-conflicts.js`, `import-planner.js` | Reworked from the owner's fork of TapTop Helper, folder `features/layers/import-sync/`. That folder is absent from the GoodMade `v1.4.1-test` release base and untracked in the fork, i.e. fork-local work. 17 of 905 long lines of the importer match it; 5 generic lines match the GoodMade release | Decided 2026-10-09: the owner's own work |
| `src/editor/taptop-runtime-adapter.js` | Written for this importer; obtains the editor's internal `require` with the same webpack-chunk technique, and uses the same internal Taptop structures, as the GoodMade Helper release (no license file there; the fork has the author's personal permission) | Decided 2026-10-09: own extension, own rights; no Helper code is copied, only the same access technique |
| `src/fonts/InterVariable.woff2` | Inter, SIL Open Font License 1.1 (`src/fonts/LICENSE.txt`) | Keep the license file in the ZIP |
| `src/icons/`, popup and editor UI | Origin not recorded in this project | The owner's work (confirmed 2026-10-13) |
| `contracts/`, `fixtures/compatibility/` | Synthetic data produced by Taptop Toolkit | Publishable with the Toolkit license |

The Toolkit keeps the detailed record in its `system/docs/PROVENANCE.md`.
