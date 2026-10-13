# Extension UI — анатомия компонентов

Значения взяты из реестра shadcn `radix-maia` (пресет `bbVK0Gm`, radius Medium = 10px) и закреплены токенами в `:host` файла `extension/editor/import-ui.css`. Сырые цвета вне блока токенов запрещены тестом.

| Область | Решение |
| --- | --- |
| Шрифт | Inter Variable, зарегистрирован как `TT Inter` через FontFace (web-accessible ресурс). В поп-апе размеры заданы явно: Chrome уменьшает базовый шрифт поп-апов |
| Иконка расширения | синий круг `#3290FF` с белым Lucide `import`; PNG 16/32/48/128 из `icons/icon.svg` |
| Цвета | Neutral: foreground `#0A0A0A`, muted `#F5F5F5`, muted-foreground `#737373`, border `#E5E5E5`; primary Taptop blue `#3290FF` |
| Радиусы | lg 10px (media, alert) · 2xl 18px (item, card, dropzone, tooltip) · 4xl 26px (dialog, button, badge, progress) |
| Launcher | Button icon-lg 40×40, круг, fixed `right:24px; bottom:88px`, Tooltip «Импорт JSON» |
| Dialog | нативный `<dialog>` в closed shadow root; max-width 448, padding 24, gap 24, ring 1px foreground/5, overlay `rgb(10 10 10 / .24)` + blur 1px (светлее Maia: виден ход импорта), мягкая тень диалога |
| Заголовок | 16px / 500 / line-height 1; описание 14px muted |
| Button | h-36, px-12, pill, 14px/500; outline = border + input/30; focus ring 3px primary/50; active translateY(1px); disabled opacity .5 |
| Footer | две кнопки 50/50; одна кнопка по центру, min-width 160 |
| Dropzone | Empty dashed 1.5px, radius 18, padding 40/24, media 40×40 radius 10; ошибка — красная зона с именем файла и причиной |
| Item / список изменений | radius 18, padding 12/14, gap 14; строки разделены 1px border, hover без собственного радиуса |
| Badge | h-20, px-8, pill, 12px/500 |
| Прогресс | кольцо 112px, stroke 8, процент в центре; заголовок = текущий шаг, сменяется сдвигом 300ms; счётчик «n из N» — серая плашка 20px/12px справа от заголовка, оптически центрирована (translateY 1.65px, замер 0); экран загрузки: padding 40/32/36, кольцо → заголовок 28px, заголовок → описание 6px |
| Результат | знак 56px (успех / ошибка / предупреждение), заголовок 18/500, текст ровно в две строки |
| Motion | 150–300ms ease-out только для обратной связи; `prefers-reduced-motion` отключает анимации |
