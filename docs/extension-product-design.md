# Taptop Toolkit Importer — archived product direction

**Status:** superseded on 2026-10-06. Do not implement this document as-is.
The source of truth is [extension-ui/DESIGN.md](extension-ui/DESIGN.md), with
the component anatomy, inventory and decisions in that same folder. This file
is retained only as historical context; its toolbar-first path, Layers button
and bottom-toast requirements are obsolete.

## Product promise

When the live adapter is enabled, import an editable Taptop block from one JSON file. Images upload automatically. The person never selects an asset folder, finds a root layer, or operates the clipboard.

## Entry points

1. **Browser toolbar icon** — first-contact help and a session-only entry action. It explains: open a Taptop project in the editor, press “Показать кнопку импорта”, then use the blue Toolkit control in Layers. The toolbar click grants temporary access only to the active tab; no persistent site permission is required.
2. **Layers import control** — primary entry point in an open Taptop editor. It opens the import card and therefore makes a separate “is this page ready?” status unnecessary.

The toolbar icon uses a blue `#3290FF` circle with a white simple mark. Supply 16, 32, 48, and 128 px variants. Do not use tiny `TT` lettering.

## Light visual system

- Typeface: Inter.
- Page/background: `#F8F9FB`.
- Surface: `#FCFDFF`.
- Main text: `#0B0B0E`.
- Secondary text: `rgba(11, 11, 14, 0.5)`.
- Primary: `#3290FF`; pressed/hover: `#2873CC`.
- Borders: `rgba(11, 11, 14, 0.08)` normally and `rgba(11, 11, 14, 0.14)` where separation needs more clarity.
- Buttons show feedback on pointer-down, visible keyboard focus, and respect reduced motion.

## Import card

The in-editor card contains exactly one file control and one primary action:

```text
Импорт в Taptop
Выберите JSON экспорта. Изображения загрузятся автоматически.

[ Выбрать JSON ]

<after validation>
landing-v4.json
12 слоёв · 8 классов · 3 изображения
[ Импортировать ]
```

Malformed files replace the summary with a plain-language error and “Выбрать другой JSON”. Terms such as *asset folder*, *clipboard*, and *root* do not appear in the happy path.

## Progress and outcome

During import a compact, non-blocking white toast is centered at the bottom of the editor canvas. It contains a small blue progress ring/line and one factual line:

- `Проверяем JSON`
- `Готовим изображения`
- `Загружаем изображения · N из M`
- `Добавляем на страницу`

Completion is shown only when the import receipt has a `rootTagId` and a `mediaBindings` array:

`Готово — блок добавлен на страницу`

An error remains visible with the failed phase and one action: `Повторить`. Details are secondary and never block recovery.

## Updates and class synchronization

A first import records a target-local receipt. On a later export from the same Toolkit namespace and component key, the extension compares the package with that receipt.

- unchanged class: no operation;
- changed Toolkit-owned property: update it;
- new class: add it;
- removed class: retain it in MVP;
- manually modified target property: do not overwrite silently; offer “Оставить изменения в Taptop” or “Обновить из JSON”.

For a package without a matching receipt, treat the action as a new import. Never update classes from an unrelated source project.

## MVP boundary

The new Toolkit currently has the package contract, session state machine, toolbar-to-Layers control and offline validation. A live Taptop adapter must be confirmed on a disposable editor before the import action is enabled. Unit tests, a visible launcher, or a visually successful toast are not proof of import.
