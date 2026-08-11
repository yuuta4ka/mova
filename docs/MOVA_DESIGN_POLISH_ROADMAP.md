# Design & polish roadmap Mova

Дата аудита: 11 августа 2026 года.

## Назначение документа

Этот roadmap отвечает не на вопрос «как переписать Mova», а на вопрос «какими небольшими проверяемыми проходами довести уже работающий мессенджер до ощущения цельного desktop-продукта».

Основа аудита:

- переданный список болей и приоритетов;
- фактическая реализация `src/RealApp.tsx`, `src/components/Primitives.tsx`, `src/components/AppleEmoji.tsx` и `src/hooks/useVoiceCall.ts`;
- реальный CSS cascade из `src/main.tsx`;
- Electron-оболочка в `desktop/main.mjs` и экран подключения в `desktop/setup.html`;
- существующий `docs/MOVA_TECHNICAL_ROADMAP.md`, чтобы не смешать visual polish с уже найденными backend/realtime-задачами;
- ручная проверка локального интерфейса на desktop-ширине и на viewport 390 × 844, включая чат, профиль, настройки и состояния звонка.

На этом проходе продуктовый код не менялся.

## Короткий вывод

Mova уже имеет узнаваемое направление: тёмный спокойный фон, фиолетовый акцент, крупные поверхности с мягкими углами, двухколоночная структура, компактные пузырьки и отдельный полноценный экран звонка. Новый дизайн с нуля не нужен.

Ощущение vibe-code создаёт не отсутствие красивых элементов, а отсутствие одного окончательного набора правил. Реальный UI собирается из нескольких исторических слоёв: базового UI-kit, Telegram-подобной темы, функциональных дополнений чата, отдельных стилей звонка и позднего `polish.css`. Один и тот же элемент поэтому последовательно получает несколько размеров, радиусов, цветов и состояний. Некоторые экраны уже выглядят близко к продукту, а соседние сохраняют текст 8–10 px, нативные browser controls или другой визуальный язык.

Главный первый экран для polish — история чата. Она используется постоянно, содержит самые заметные пункты из списка болей и может быть улучшена без изменения backend, WebRTC или Electron.

## 1. Карта реального интерфейса

| Область | Фактическая реализация | Основные стили | Наблюдение |
| --- | --- | --- | --- |
| Запуск и общий shell | `src/main.tsx`, `RealApp`, `Product` в `src/RealApp.tsx` | `src/styles.css`, `src/telegram.css`, `src/polish.css` | Реальный продукт — `RealApp`, а не демонстрационный `src/App.tsx`. |
| Левая навигация | `Product`: `.mova-tg-sidebar`, меню аккаунта, search, resize handle | `telegram.css`, `call.css`, `polish.css` | Один список объединяет DM и группы; sidebar можно растянуть или свернуть в avatar rail. |
| Список чатов/групп | `Product`: `.mova-real-chat-list`, `ConversationAvatar` | `styles.css`, `telegram.css`, `polish.css` | Есть loading skeleton, search-empty и обычный empty-state. Нет визуального разделения друзей/групп и явной unread-системы. |
| Шапка диалога | `RealMessages`: `.mova-real-thread__header`, `mova-chat-identity` | `telegram.css`, `chat-functional.css`, `polish.css` | Presence и typing конкурируют за одну secondary-строку. |
| История сообщений | `RealMessages`: `.mova-real-messages` | `styles.css`, `telegram.css`, `chat-functional.css`, `polish.css`, частично `call.css` | Есть search highlight, reply jump, selected state, image viewer и sending/failed/read states. Нет day separators. |
| Message Bubble | `RealMessages`: `.mova-real-bubble`, `MessageStatus` | те же четыре слоя CSS | Базовая геометрия хорошая, но значения несколько раз переопределяются. |
| Группировка сообщений | локальные `grouped`/`continuesGroup` в `RealMessages` | `chat-functional.css` | Группа определяется только автором и интервалом < 5 минут; календарный день не учитывается. |
| Avatar | `Avatar` в `src/components/Primitives.tsx`, `ConversationAvatar` | `styles.css` плюс многочисленные context overrides | Базовые initials — squircle, фото — circle, а чат/sidebar/call принудительно делают circle. |
| Status indicator | `Avatar` + `avatarStatus`, отдельные точки в `AccountMenu` | `styles.css`, `telegram.css`, `polish.css` | Цвета централизованы частично, но размеры, border и названия статусов зависят от контекста. |
| Composer | `RealMessages`: textarea, attach, reply/edit preview, send | `styles.css`, `telegram.css`, `chat-functional.css`, `polish.css` | Основное состояние уже качественное; надстройки reply/file/error меняют высоту и ритм. |
| Typing indicator | header secondary text и `.mova-real-typing` над composer | `chat-functional.css` | Один и тот же typing показывается одновременно в двух местах. |
| Emoji | `AppleEmoji`, массив из 12 emoji в `RealMessages` | `chat-functional.css`, `polish.css` | Apple-набор загружается с внешнего CDN; picker — только 12 кнопок без подписей, категорий и поиска. |
| Context menus | chat actions, message context, account, call volume/more | `styles.css`, `chat-functional.css`, `call.css`, `polish.css` | Меню похожи по назначению, но имеют ширины 194/274/300/310 px и разные radius/padding/type scale. |
| Модальные окна | `ProfileEditor`, `SettingsModal`, `CreateConversation`, image viewer | `styles.css`, `settings.css`, `chat-functional.css`, `polish.css` | Backdrop унифицирован частично; содержимое и controls остаются из разных поколений. |
| Профиль | `ProfileEditor`, settings profile preview, account card | `styles.css`, `settings.css`, `polish.css` | Один профиль представлен тремя разными композициями. Edit Profile всё ещё содержит ручную activity. |
| Настройки | `SettingsModal`, `RangeSetting`, `ToggleSetting` | `settings.css`, `polish.css` | Структура понятная, но native `range`/`select` заметно отличаются от остальных controls. |
| Звонок | `VoiceCallBar`, `PendingCallStage`, `CallTileShell` и tile-компоненты | `call.css`, поздние overrides в `polish.css` | Pending и active call уже выглядят как самостоятельный продуктовый экран; CSS сильно наслоён. |
| Fullscreen camera/screen-share | `CallTileShell`, portal в `document.body`, `.is-expanded` | `call.css` | Есть double-click, кнопка fullscreen и отдельный mobile PiP; controls не autohide. |
| Desktop Electron | `desktop/main.mjs`, `desktop/setup.html` | native frame + inline CSS setup-экрана | Безопасная shell есть, но окно использует обычный системный frame; Windows получает стандартный title bar. |
| Mobile/responsive | CSS media queries ≤ 900/760/520 px | `polish.css`, `chat-functional.css`, `call.css` | Звонок адаптируется заметно лучше основного чата. На 390 px постоянный rail забирает 72 px, нет обычного mobile navigation flow. |
| Focus/hover/pressed/disabled | `Button`, `IconButton` и локальные `<button>` | все CSS-слои, особенно `input-focus.css` и `polish.css` | Общий focus-visible восстановлен поздним слоем, но локальные исключения и скрытые inputs оставляют пробелы. |
| Loading/empty/error | skeleton-компоненты, empty list, boot, inline errors | `RealApp.tsx`, `chat-functional.css`, `auth.css`, `polish.css` | Loading стал аккуратнее; server error для загрузки overview/history не имеет полноценного retry/error-state. |

## 2. Где дизайн централизован, а где распадается

### Что уже можно сохранить

- `src/components/Primitives.tsx` задаёт полезную основу: `Button`, `IconButton`, `Avatar`, `Input`, `Modal`, `Tooltip`.
- `:root` в `src/styles.css` содержит исходные роли цвета, focus, shadow и motion.
- `src/polish.css` уже пытается ввести product-wide surface roles (`--mova-ui-*`) и единый focus-visible.
- Lucide используется почти для всех функциональных иконок в `RealApp.tsx`; отдельный icon pack искать не нужно.
- Chat bubbles, pending call, call tiles и composer уже имеют направление, которое можно эволюционно уточнить.

### Где правила продублированы

Порядок импортов в `src/main.tsx` важен: `styles.css` → `telegram.css` → `chat-functional.css` → `settings.css` → `call.css` → `input-focus.css` → `auth.css` → `landing.css` → `polish.css` → `brand.css`.

Конкретные примеры cascade:

- `--mova-chat-content-width` проходит значения 696 px в `telegram.css`, 820 px в `chat-functional.css` и 880 px в `polish.css`.
- Header диалога сначала имеет 68 px в `styles.css`, затем 48 px в `telegram.css`, 56 px в поздней части `chat-functional.css` и 60 px в `polish.css`.
- Bubble меняет padding, radius, border и shadow в четырёх файлах. Итог нельзя понять, читая один selector.
- Sidebar row имеет высоту 61 px в `styles.css`, 72 px в `telegram.css` и 70 px в `polish.css`.
- Settings повторно задаёт сетку 190 px в `settings.css`, затем 220 px в `polish.css`.
- Call controls в `call.css` сначала строятся как icon + подпись, затем превращаются в pill dock только более поздними selectors.

`polish.css` полезен как направление, но его комментарий «final product-wide visual system» пока описывает override-слой, а не единый источник правил. На polish-проходах следует переносить окончательное правило к владельцу компонента и удалять перекрытое правило только в затронутой области. Глобальную чистку всего CSS одним PR делать не нужно.

### Где значения выглядят случайными

Проблема не в самом наличии 7, 9 или 13 px, а в их количестве без общей роли. В старых selectors одновременно встречаются подписи 7, 8, 9, 10 и 11 px; radius 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 22, 24, 26, 27 и 28 px. В результате похожие controls отличаются на 1–3 px без заметной продуктовой причины.

Особенно видимые примеры:

- labels и help text в `ProfileEditor` остаются 7–10 px из `styles.css`, хотя settings и chat позднее увеличены;
- `Button` primary остаётся mint gradient из базового UI-kit, тогда как selected/send/call actions используют пользовательский purple accent;
- `mova-message-context-menu`, `mova-chat-actions-menu`, `mova-account-menu` и `mova-call-more` имеют разный типографический scale и геометрию;
- `select` и `range` в settings выглядят более нативно, чем соседние Mova buttons/toggles;
- базовый `Avatar` показывает initials как squircle, фото как circle, а разные экраны затем меняют форму контекстными overrides.

## 3. Почему Mova ощущается vibe-coded

### 3.1. Интерфейс собран слоями тем, а не одним набором решений

Файлы `styles.css`, `telegram.css`, `chat-functional.css` и `polish.css` одновременно владеют header, history, bubble и composer. Поэтому мелкое изменение в позднем файле маскирует, а не заменяет старое решение. Это главная системная причина визуальной случайности.

### 3.2. Типографика резко меняется между соседними экранами

Chat body уже использует комфортные 16/22 px, sidebar — 15/13 px, settings после polish — 13–16 px. Но `ProfileEditor` наследует labels 8 px, inputs 10 px и help 7 px. `call.css` также содержит исторические 8–10 px подписи, частично увеличенные в конце файла. Визуально это выглядит так, будто разные экраны делали в разном масштабе.

Файлы: `src/styles.css`, `src/settings.css`, `src/call.css`, `src/polish.css`.

### 3.3. Одинаковые по смыслу surfaces не являются одним семейством

Account menu, message menu, chat menu, emoji picker, screen-share menu и modal используют близкие тёмные цвета, но разные background, border opacity, shadow, blur, width и radius. `polish.css` объединяет четыре из них, но call menus остаются отдельными.

Файлы: `src/chat-functional.css`, `src/call.css`, `src/polish.css`.

### 3.4. Focus и pressed состояния зависят от того, каким способом создан control

`input-focus.css` глобально убирает outline/box-shadow у inputs, а загруженный позже `polish.css` возвращает общий outline. При этом `mova-chat-identity` и context-menu items снова сбрасывают outline локально, hidden checkbox получает focus вместо видимого switch, а часть нативных controls имеет собственное browser-поведение. У `Button` pressed есть, у многих локальных menu buttons — только hover.

Файлы: `src/input-focus.css`, `src/polish.css`, `src/chat-functional.css`, `src/settings.css`, `src/call.css`.

### 3.5. Avatar и presence не подчиняются одному компонентному контракту

`Avatar` уже централизован, но форма и размер переопределяются почти на каждом экране. Status point использует `.mova-status` в компоненте, `.mova-avatar__status` в некоторых styles и отдельные `<i>` в `AccountMenu`. Это создаёт разные border, offset и семантику одного статуса.

Файлы: `src/components/Primitives.tsx`, `src/styles.css`, `src/telegram.css`, `src/RealApp.tsx` (`AccountMenu`, `ConversationAvatar`).

### 3.6. Основной чат имеет неполную систему времени и группировки

Сообщения объединяются по автору и пяти минутам, но без границы календарного дня. Day separators отсутствуют. Avatar входящего автора стоит у первого сообщения блока, включая DM; желаемое правило для групп — avatar у последнего сообщения блока. Username, avatar, tail и отступы поэтому не образуют одного читаемого message block.

Файл: `RealMessages` в `src/RealApp.tsx`; геометрия — `src/chat-functional.css`.

### 3.7. Некоторые controls выглядят как browser UI внутри приложения

Native range track, select arrow/option menu и scrollbar в settings визуально выбиваются. Windows desktop добавляет к этому стандартный системный title bar над web-like content. Получается «сайт в окне», хотя call screen и main shell уже тянут интерфейс в сторону desktop app.

Файлы: `src/settings.css`, `src/polish.css`, `desktop/main.mjs`.

### 3.8. Empty/loading сделаны лучше, чем error/offline

Conversation/message skeletons аккуратные, boot и empty-list понятные. Но ошибка загрузки conversations/history фактически не превращается в устойчивый экран с объяснением и retry; `syncOverview` подавляет ошибку. Отдельного offline/reconnecting banner нет. Это не всегда видно, но в плохой сети мгновенно возвращает ощущение прототипа.

Файлы: `ConversationListSkeleton`, `MessageListSkeleton`, `Product` в `src/RealApp.tsx`.

## 4. Рекомендуемый визуальный язык Mova

Это эволюция текущей Mova: спокойные тёмные surfaces, один фиолетовый accent, минимум декоративного blur, ясная текстовая иерархия и controls, рассчитанные на несколько часов использования.

### Типографика

Выбрать один реально загружаемый интерфейсный font. Сейчас Manrope импортирован в `main.tsx`, но `polish.css` назначает не подключённый Inter и фактически переключает UI на system font. Практичный вариант — оставить Manrope для всей Mova и system font только как fallback.

| Роль | Размер / line-height | Weight | Где использовать |
| --- | --- | --- | --- |
| Основной текст | 15/21 px; в bubble допустимо 16/22 | 450–500 | сообщения, описания, значения полей |
| Secondary text | 13/18 px | 450–500 | presence, preview чата, пояснения |
| Caption | 12/16 px | 500–600 | labels, help, counters, системные подписи |
| Timestamp/meta | 11/14 px | 500, tabular nums | время, delivery meta, call duration |
| Username/row title | 14/19 px | 600–650 | имя автора группы, название чата в списке |
| Screen title | 20/26 px | 650–700 | modal/profile/settings title |

На узком экране основной текст можно уменьшить на 1 px. Не возвращаться к 7–10 px для функционально важного текста.

### Spacing

Основная шкала: **4, 8, 12, 16, 20, 24, 32 px**.

- 4 px — связь caption с value, иконки внутри compact meta;
- 8 px — внутренний gap controls и соседние сообщения блока;
- 12 px — compact padding menu row/bubble;
- 16 px — стандартный panel padding и расстояние между независимыми блоками;
- 20/24 px — modal sections и desktop page gutters;
- 32 px — крупные смысловые разделы.

6 px допустим для оптического выравнивания composer/bubble. Значения 7, 9, 11, 13 и 17 px не запрещены, но должны появляться как локальное оптическое исключение, а не как новая шкала.

### Radius

| Роль | Radius |
| --- | --- |
| Small control / tooltip | 8 px |
| Input / menu row / compact card | 12 px |
| Bubble / panel / tile | 18 px |
| Modal / крупная shell surface | 22–24 px |
| Avatar / icon action / pill | 999 px |

У message bubble остаётся специальный угловой вариант/tail. Это часть характера Mova, а не повод делать все остальные radii уникальными.

### Surfaces

Свести существующие цвета к ролям, не меняя направление палитры:

| Роль | Назначение |
| --- | --- |
| App background | самый тёмный canvas вокруг рабочих областей |
| Sidebar | отдельная спокойная навигационная поверхность |
| Main panel | история/настройки без лишней рамки вокруг каждого элемента |
| Raised panel | card, call tile, settings section |
| Hover | один нейтральный overlay для rows/menu items |
| Selected | смесь accent + panel, не сплошная яркая заливка везде |
| Input | чуть более тёмная поверхность с видимой границей только при необходимости |
| Modal/popover | один raised цвет, один border, один shadow; blur умеренный или отсутствует |

`--mova-ui-*` из `polish.css` можно использовать как начало, но следует выбрать один namespace вместо параллельных `--mova-surface-*` и `--mova-ui-*`.

### Interactive states

Каждый button, row, menu item, input и tile должен иметь один контракт:

| State | Правило |
| --- | --- |
| Default | достаточный contrast, без постоянной декоративной рамки |
| Hover | небольшое изменение surface/color, без прыжка layout |
| Pressed | scale 0.97–0.98 или более тёмная surface; не оба сильных эффекта одновременно |
| Focus-visible | 2 px accent ring + 2 px offset или внутренний ring для тесных controls |
| Disabled | сниженный contrast, `cursor: not-allowed`, отсутствие hover/pressed motion |
| Selected | accent-tinted surface + дополнительный non-color cue (inset line/check) |

Focus нельзя просто удалять. Для hidden checkbox focus-ring должен рисоваться на видимом switch через `:focus-visible + i`/`:focus-within`.

### Motion

- menu/popover: fade + 4–6 px translate, 140–170 ms;
- modal: fade backdrop 150 ms, content 180–220 ms;
- hover/pressed: 120–160 ms;
- fullscreen controls: fade 160 ms и autohide только после реального idle;
- status change: короткая смена цвета/opacity, без pulse;
- message sending: существующее появление допустимо, но без bounce на каждом обычном сообщении;
- обязательно сохранять `prefers-reduced-motion`.

## 5. Единая система основного чата

### Message block

1. Новый block начинается при смене автора, паузе более 5 минут **или смене календарного дня**.
2. В DM avatars в истории не показываются. Идентичность уже ясна из header и стороны пузыря.
3. В группе username показывается над первым сообщением блока, avatar — возле последнего сообщения блока. Под все сообщения группового входящего блока резервируется одна одинаковая avatar-колонка, чтобы bubbles не прыгали.
4. Между сообщениями одного блока — 3–4 px; между блоками — 10–12 px; вокруг day separator — 20–24 px.
5. Tail показывается только у последнего bubble блока.
6. Timestamp и delivery status образуют один meta-row и не меняют высоту короткого bubble.

### Время и разделители

Day separator вставляется перед первым сообщением нового локального календарного дня. Формат: «Сегодня», «Вчера», затем «11 августа» и с годом, если год отличается. Separator является sticky только если после ручной проверки это не отвлекает; базовый вариант — обычный нейтральный divider.

### Reply, attachments, links

- Reply preview остаётся внутри bubble, но использует один accent line без полосатого декоративного паттерна.
- Image-only, image+caption и file cards сохраняют текущую специальную компоновку.
- URL в message content становится настоящей ссылкой с keyboard focus. В Electron внешний URL продолжает уходить в системный браузер через существующий `setWindowOpenHandler`/`will-navigate`.
- Link preview — одна card на первый поддерживаемый URL: domain, title, 1–2 строки description, optional thumbnail. Нужны loading/error/fallback; неизвестный или небезопасный URL остаётся обычной ссылкой.

### Typing

Typing показывается только над composer. Header всегда показывает presence/member count; layout header не прыгает при начале печати. В typing label остаётся имя для группы, а в DM достаточно «печатает…».

### Emoji

- Один renderer для content, preview, title и picker.
- Текущий Apple style можно сохранить, но CDN failure не должен оставлять пустые кнопки.
- Полный picker: search, recent, категории, skin tones, keyboard arrows/Enter/Escape, понятные `aria-label`.
- Picker не должен закрывать последние сообщения; на mobile он открывается bottom sheet или системной по размеру панелью.

### Hover actions и selection

Сейчас есть context menu по ПКМ и selection state. В desktop добавить компактные hover/focus actions для reply и edit; ПКМ остаётся расширенным способом. Actions должны появляться и при `focus-within`, а не только от мыши. Selection bar должен содержать только реально работающие действия; не обещать delete/forward до реализации semantics.

### Empty/error

Пустой чат сохраняет intro, но composer должен визуально быть главным следующим действием. Ошибка загрузки истории показывает inline card «Не удалось загрузить сообщения» + «Повторить», не пустой canvas. Offline/reconnecting — отдельный спокойный status, не красный toast на каждую попытку.

## 6. Разбор пунктов списка болей

Шкалы: заметность/влияние — низкое, среднее, высокое; сложность — S, M, L, XL. «Ближайший pass» означает design-polish roadmap, а не общий технический приоритет продукта.

| Пункт | Тип | Заметность | Влияние на качество | Сложность | Экран/компонент | Ближайший polish pass |
| --- | --- | --- | --- | --- | --- | --- |
| Единое отображение emoji | Visual polish | Высокая | Высокое | M | `AppleEmoji`, message/list/reply | Да, этап 1–2 |
| Разделители сообщений по дням | UX | Высокая | Высокое | M | `RealMessages` history | Да, этап 1 |
| Убрать typing из header | Visual polish | Высокая | Среднее | S | `mova-chat-identity` | Да, этап 1 |
| Не показывать avatar сообщений в DM | Visual polish | Высокая | Высокое | S | message block | Да, этап 1 |
| Avatar у последнего сообщения блока группы | UX | Высокая | Высокое | M | grouping + message layout | Да, этап 1 |
| Единый focus-visible | Visual polish | Средняя | Высокое | M | buttons/inputs/menus/switches | Да, поэтапно; системно этап 6 |
| Кликабельные ссылки | UX | Высокая | Высокое | M | message content | Да, этап 1 |
| Link preview | Product feature | Средняя | Среднее | L | message content/card + metadata | После базовых ссылок; не блокирует этап 1 |
| Полноценное emoji menu | Product feature | Высокая | Высокое | L | composer/picker | Да, этап 2 |
| Hover actions сообщений | UX | Средняя | Высокое | M | message block/context menu | Да, этап 1 |
| Согласовать selected/sending/failed/read | Visual polish | Высокая | Высокое | M | message + selection bar | Да, этап 1 |
| Empty/error state истории | UX | Средняя | Высокое | M | history loading/error | Да, этап 1 |
| Composer, reply и attachment как одна система | Visual polish | Высокая | Высокое | M | composer | Да, этап 2 |
| Redesign Edit Profile | Visual polish | Высокая | Высокое | M | `ProfileEditor` | Да, этап 4 |
| Поле «Имя» вместо «Отображаемое имя» | UX | Средняя | Среднее | S | `ProfileEditor` | Да, этап 4 |
| «Имя пользователя» + отдельный префикс `@` | UX | Высокая | Высокое | S | profile input | Да, этап 4 |
| Единый `StatusIndicator` | Visual polish | Высокая | Высокое | M | avatar/sidebar/profile/call | Да, этап 4 |
| Online/offline/DND/idle semantics | UX | Высокая | Высокое | M | account/profile/header | Да, этап 4 |
| Автоматическая desktop activity | Platform/Desktop | Средняя | Среднее | L | Electron + presence | Нет, отдельная product feature |
| Плитки участников звонка | Visual polish | Высокая | Высокое | M | `CallTileShell`/grid | Да, этап 3 |
| Responsive call layout | UX | Высокая | Высокое | L | call grid/PiP/chat | Да, этап 3 |
| Согласовать call controls и состояния mute/deafen/camera | Visual polish | Высокая | Высокое | M | `CallControlButton` | Да, этап 3 |
| Fullscreen camera/screen-share | UX | Высокая | Высокое | M | tile expand/portal | Да, этап 3 |
| Autohide fullscreen controls | UX | Средняя | Среднее | M | fullscreen tile/control dock | Да, этап 3 |
| Выбор устройств | UX | Высокая | Высокое | M | settings audio | Да, этап 3/6, без смены media engine |
| Переключение микрофона работает нестабильно | Bug | Высокая | Высокое | L | `useVoiceCall`, device settings | Нет, отдельное investigation |
| Noise suppression quality | Realtime/calls | Высокая | Высокое | L | media constraints/processing | Нет, technical call track |
| Высокий ping / 5 FPS | Realtime/calls | Высокая | Высокое | XL | WebRTC/media/network | Нет, не CSS-задача |
| Расширенные WebRTC stats | Realtime/calls | Средняя | Высокое | L | `useVoiceCall` diagnostics | Нет, technical call track |
| TURN production reliability | Infrastructure | Высокая | Высокое | L | deployment/RTC config | Нет, отдельный smoke test |
| Windows title bar | Platform/Desktop | Высокая | Высокое | L | `desktop/main.mjs` + renderer chrome | Да, этап 5 |
| Drag regions/system buttons | Platform/Desktop | Высокая | Высокое | L | desktop shell | Да, этап 5 |
| Resize/fullscreen/system menus | Platform/Desktop | Средняя | Высокое | M | BrowserWindow/menu | Да, проверить на этапе 5 |
| Внешние ссылки | Platform/Desktop | Средняя | Высокое | S | Electron navigation guards | Уже хорошо; regression-check этап 5 |
| Update UI | Platform/Desktop | Средняя | Среднее | M | `desktop/main.mjs` dialogs/status | После shell polish, не блокирует |
| Mobile main navigation | Mobile/PWA | Высокая | Высокое | L | sidebar/thread flow | Да, этап 7 |
| Push в закрытой PWA | Infrastructure | Высокая | Высокое | XL | service worker/push backend | Нет |
| Offline architecture/outbox | Infrastructure | Высокая | Высокое | XL | cache/outbox/API | Нет |
| Message cursor/reconnect gap | Infrastructure | Средняя | Высокое | L | server/API/client sync | Нет |
| Persistent message cache | Infrastructure | Средняя | Высокое | L | IndexedDB/message store | Нет |
| Pagination старой истории | Infrastructure | Средняя | Высокое | L | API/history | Нет |
| Idempotent retry без дублей | Bug | Высокая | Высокое | L | database/API/send state | Нет, технический приоритет отдельно |
| Drafts | Product feature | Средняя | Среднее | M | composer storage | После composer polish |
| Upload progress/cancel/retry | Product feature | Средняя | Среднее | L | upload transport/composer | Не в design pass |
| Mute не выключает notification | Bug | Высокая | Высокое | M | realtime notification handler | Исправить отдельно, не маскировать стилями |
| Локальные «Удалить чат»/«Заблокировать» | Bug | Высокая | Высокое | L | chat actions + server semantics | Отдельно; до этого не усиливать UI promise |

## 7. Звонки: polish отдельно от technical quality

### Что уже является хорошей основой

- `PendingCallStage` визуально собран и одинаково читается на desktop/mobile.
- Active call — отдельный canvas, а не маленькая панель поверх чата.
- Есть remote-first mobile layout, self PiP, speaking border, network quality, call chat, screen-share area и fullscreen portal.
- Mute, deafen, camera, screen, chat, more и hangup сведены в один dock.

### Visual/UX polish

- зафиксировать один tile radius, label style и speaking treatment;
- убрать перекрывающие ранние/поздние варианты `.mova-call-tile` и `.mova-call-controls` в пределах этапа;
- определить layout для 1, 2, 3, 4 и 5+ участников, с/без screen-share и с открытым call chat;
- на fullscreen скрывать chrome после 2.5–3 секунд idle, возвращать на mouse move/touch/key/focus;
- сделать camera и screen fullscreen одинаковыми по управлению;
- device selector открыть из call «Дополнительно» без необходимости искать settings;
- сохранить явные состояния mute/deafen/camera и не полагаться только на цвет;
- показать понятное «Подключаемся/Восстанавливаем соединение» без имитации технического успеха.

### Technical quality — отдельный track

- фактическое переключение input device и замена audio track;
- качество встроенного `noiseSuppression`, echo cancellation и auto gain;
- ping/jitter/loss, interval bitrate, FPS, dropped/frozen frames и encoder/decoder load;
- TURN relay smoke test через сложный NAT/мобильную сеть;
- recovery при Wi-Fi change, sleep/wake и signaling reconnect.

Эти задачи нельзя объявлять закрытыми после перестановки tiles или изменения CSS.

## 8. Desktop shell

### Текущее состояние

`desktop/main.mjs` корректно оставляет React/API/WebRTC в renderer, ограничивает разрешения trusted origin, открывает внешние ссылки системно, поддерживает single instance, screen picker и updater. Это хорошая архитектурная граница.

`BrowserWindow` создаётся с обычным frame. На macOS это нейтрально, но на Windows стандартный title bar визуально отделён от Mova shell и усиливает эффект «сайт открыт в Electron».

### Рекомендуемое направление

- Сначала сделать custom titlebar только для Windows; macOS оставить native/hiddenInset только после отдельной проверки traffic lights.
- Titlebar: 36–40 px, Mova wordmark/название, drag region, minimize/maximize/restore/close.
- Все interactive children обязаны иметь `-webkit-app-region: no-drag`; сама полоса — `drag`.
- Системные кнопки должны повторять Windows hit targets и danger hover close, а не быть круглыми web-icon buttons.
- Нужен небольшой preload/API только для window actions и platform/version flags. Не переносить сообщения, calls, presence или navigation state в main process.
- Проверить resize с minimum sizes, maximize/restore icon, F11/fullscreen, double-click titlebar, Windows scaling 125/150%, high contrast.
- Сохранить существующие guards внешних ссылок и permission model.
- Update UI можно позднее вывести в settings/about; на первом shell pass достаточно не ухудшить текущие native dialogs.

## 9. Профиль и presence

Это три разные задачи.

### 1. Visual redesign профиля

- привести labels/help к общей type scale;
- переименовать поле в «Имя»;
- поле username показывает фиксированный prefix `@` вне editable value;
- primary action использует текущий accent, а не отдельный mint UI-kit gradient;
- preview banner/avatar и form должны выглядеть одним экраном, а не card + мелкая admin-форма;
- activity убрать из основного Edit Profile либо вынести в отдельный «Статус/активность» блок.

### 2. Единый status component

Один `StatusIndicator` должен задавать size, offset, border surface, color и accessible label. Состояния: online, idle, DND, offline/invisible. Он используется внутри `Avatar` или рядом с ним, а не рисуется отдельными `<i>` в каждом меню.

Invisible для самого пользователя и offline для других могут делить визуальный цвет, но не текстовую семантику.

### 3. Автоматическая desktop activity

Определение запущенной программы — отдельная desktop product feature с вопросами privacy, permissions, platform support и opt-in. Она не должна блокировать redesign профиля и не должна внедряться как случайный Electron process scanner.

## 10. Incremental polish roadmap

Порядок из задачи в целом верный. Chat history и composer разделены, потому что после первого этапа уже будет заметный результат, а полноценный emoji picker не раздует scope истории. Calls остаются раньше profile, поскольку это один из главных ежедневных экранов и его основа уже сильная.

### Этап 1 — Chat history polish

**Цель:** сообщения читаются как последовательные блоки разговора, а не набор отдельных bubbles.

**Что увидит пользователь:** day separators; DM без повторяющихся avatars; в группе avatar у конца блока; стабильные username/timestamp/status; работающие links; единый hover/focus/selected; typing исчезнет из header.

**Компоненты:** `RealMessages`, message block/bubble, `MessageStatus`, `Avatar`, reply, attachment, history empty/error.

**Закрывает:** emoji consistency в истории, day separators, header typing, DM avatar, group block avatar, links, hover actions, selected/sending/failed/read, empty/error.

**Вероятные файлы:** `src/RealApp.tsx`, `src/chat-functional.css`, небольшой shared helper для calendar grouping/link rendering, `src/components/AppleEmoji.tsx`, tests `src/RealApp.test.tsx`.

**Нельзя сломать:** optimistic reconciliation, retry того же message, read receipts, reply jump/search highlight, image loading/scroll-to-bottom, call system messages.

**Ручная проверка:** DM и group; блоки 1/2/3 сообщений; два автора подряд; граница 23:59/00:01; long text; link; reply; image/file; sending/failed/read; keyboard focus; empty/error.

**Размер:** большая, но хорошо ограниченная одним экраном.

### Этап 2 — Composer + emoji

**Цель:** всё, что относится к созданию сообщения, выглядит и ведёт себя как одна система.

**Что увидит пользователь:** стабильная высота composer; аккуратные reply/edit/attachment/error rows; полноценный emoji picker; единые emoji; понятные focus/pressed/disabled.

**Компоненты:** composer textarea, attach/send/emoji buttons, typing row, draft previews, emoji picker.

**Закрывает:** полноценное emoji menu, единые emoji, typing возле composer, composer focus-state.

**Вероятные файлы:** `src/RealApp.tsx`, `src/components/AppleEmoji.tsx`, новый небольшой `EmojiPicker` при необходимости, `src/chat-functional.css`, tests.

**Нельзя сломать:** Enter/Shift+Enter, paste/drag files, edit/reply cancellation, typing throttling, disabled blocked state, mobile keyboard/safe area.

**Ручная проверка:** mouse + keyboard; search/category/recent; emoji insertion в середину текста; skin tone; multiline; reply/edit/file; 390 px viewport.

**Размер:** средняя/большая.

### Этап 3 — Calls visual polish

**Цель:** call screen выглядит предсказуемо для любого числа участников и режима media.

**Что увидит пользователь:** стабильные tiles, единый dock, явные media states, autohide fullscreen controls, понятный screen-share и доступ к devices.

**Компоненты:** `VoiceCallBar`, `PendingCallStage`, `CallControlButton`, `CallTileShell`, `CallVideoTile`, `CallAvatarTile`, call chat, screen/call menus.

**Закрывает:** tiles, responsive layout, controls, fullscreen, hover/autohide, mute/deafen/camera state, device entry point.

**Вероятные файлы:** `src/RealApp.tsx`, `src/call.css`, визуальные tests `src/CallLayout.test.tsx`; `useVoiceCall.ts` только если UI требует уже существующее состояние, не для media rewrite.

**Нельзя сломать:** peer streams, screen aspect ratio, self PiP, expanded portal, call chat resize/unread, leave vs end semantics, reduced motion.

**Ручная проверка:** 1/2/3/4 участника; camera on/off; local/remote screen; desktop/mobile portrait/landscape; chat open; fullscreen Escape/double-click; keyboard; poor network indicator.

**Размер:** большая.

### Этап 4 — Profile + status

**Цель:** identity и presence одинаково понятны в sidebar, header, account menu, profile и settings.

**Что увидит пользователь:** аккуратный Edit Profile, крупный читаемый form, «Имя», fixed `@`, единые status dots и названия состояний.

**Компоненты:** `ProfileEditor`, `AccountMenu`, settings profile, `Avatar`/новый `StatusIndicator`, `formatPresenceStatus`.

**Закрывает:** redesign profile, name/username/@, presence component, online/offline/DND/idle.

**Вероятные файлы:** `src/RealApp.tsx`, `src/components/Primitives.tsx`, `src/styles.css`, `src/settings.css`, `src/polish.css`, tests.

**Нельзя сломать:** avatar/banner upload and compression, DND duration, idle timer, invisible semantics, profile realtime update.

**Ручная проверка:** initials/photo; each presence; DM header/sidebar/profile/account menu; validation/error/loading; desktop/mobile modal.

**Размер:** средняя.

### Этап 5 — Desktop shell

**Цель:** Windows-клиент ощущается как Mova с момента появления окна.

**Что увидит пользователь:** Mova titlebar, корректные window controls, нативное resize/maximize/fullscreen поведение, цельный фон без полосы web-page.

**Компоненты:** BrowserWindow options, preload window API, renderer titlebar/platform class, setup window.

**Закрывает:** Windows title bar, drag regions, system buttons, resize/fullscreen; проверяет external links/update dialogs.

**Вероятные файлы:** `desktop/main.mjs`, новый минимальный preload при необходимости, `src/RealApp.tsx` или отдельный titlebar component, отдельный desktop CSS, `desktop/setup.html`.

**Нельзя сломать:** sandbox/context isolation, trusted origin, external links, permissions, screen picker, updater, macOS traffic lights.

**Ручная проверка:** Windows 100/125/150%; drag from safe area; buttons; double-click; snap/maximize/restore; F11; links; update dialog; setup screen; macOS regression.

**Размер:** большая и platform-specific.

### Этап 6 — Общие modal/menu/input states

**Цель:** похожие overlays и controls наконец выглядят родственными.

**Что увидит пользователь:** одинаковые popover/modal surfaces, menu rows, focus rings, switches, select/range, loading/error actions.

**Компоненты:** primitives, create modal, account/chat/message/call menus, settings inputs/toggles/ranges, image viewer.

**Закрывает:** общие default/hover/pressed/focus/disabled/selected и browser-like controls.

**Вероятные файлы:** `src/components/Primitives.tsx`, `src/styles.css`, `src/settings.css`, `src/chat-functional.css`, `src/call.css`, сокращение затронутых overrides в `src/polish.css`.

**Нельзя сломать:** focus restoration, Escape/outside click, portal z-index, keyboard menu access, native device select functionality.

**Ручная проверка:** Tab/Shift+Tab/Enter/Space/Escape; mouse pressed; disabled; long labels; scroll; zoom 125/150%; reduced motion.

**Размер:** средняя/большая.

### Этап 7 — Mobile/responsive cleanup

**Цель:** mobile — отдельный понятный flow, а не desktop с постоянным узким rail.

**Что увидит пользователь:** список чатов и thread занимают весь экран по очереди; есть back/new/search; composer не зажат; overlays становятся sheets; call сохраняет remote-first layout.

**Компоненты:** Product navigation state, sidebar/thread header, composer, profile/settings/create, call mobile layout.

**Закрывает:** mobile navigation, narrow chat width, mobile popovers/safe areas, final responsive cleanup.

**Вероятные файлы:** `src/RealApp.tsx`, `src/polish.css`, `src/chat-functional.css`, `src/call.css`, responsive tests.

**Нельзя сломать:** desktop resizable sidebar, selected conversation persistence, incoming call takeover, mobile PiP, browser back/PWA standalone behavior.

**Ручная проверка:** 320/360/390/430 px; portrait/landscape; iOS safe areas; Android keyboard; list → chat → back; empty list; call → call chat → back.

**Размер:** большая.

## 11. Не относится к design polish

Эти задачи остаются важными в product roadmap, но не должны блокировать визуальные этапы:

- PWA push при закрытом приложении — нужен service worker, subscription lifecycle и backend delivery;
- idempotent `clientId`/защита retry от дублей — database/API correctness;
- reconnect cursor и пропущенные WebSocket events — realtime consistency;
- pagination старой истории и scroll anchoring — data/API task;
- persistent cache, outbox, offline sending и drafts persistence — local data architecture;
- upload progress/cancel/retry — transport task;
- TURN production availability — infrastructure/operations;
- ping, 5 FPS, bitrate, dropped frames, noise suppression — WebRTC investigation;
- переключение микрофона — media track/device bug;
- mute notification bug — notification behavior;
- server semantics delete/block — product/backend behavior;
- автоматическое определение desktop activity — privacy-sensitive platform feature;
- крупное разделение `RealApp.tsx` и `server/index.mjs` — постепенная engineering maintenance, не самостоятельный redesign.

Почему они не блокируют polish: message block, composer, profile, menu states и call layout можно проверить на уже существующих данных и состояниях. Но visual pass не должен скрывать technical failure красивым skeleton или менять текст «ошибка» на «готово».

## 12. Рекомендации владельцу продукта

### 1. Пять вещей, сильнее всего создающих ощущение vibe-coded

1. Один компонент переопределяется в нескольких CSS-файлах, поэтому нет видимого общего ритма.
2. Соседние экраны используют резко разные размеры текста — особенно chat/settings против Edit Profile и части call menus.
3. Avatar/status, menu/popover и input имеют несколько конкурирующих вариантов.
4. История чата не завершена как система: нет дней, DM/group rules и links, typing дублируется.
5. Mobile и Windows shell выглядят как адаптация web UI, а не как продуманные platform experiences.

### 2. Пять изменений с максимальным эффектом и минимальным риском

1. Day separators + корректные границы message blocks.
2. Убрать avatars из DM и поставить group avatar у последнего сообщения блока.
3. Убрать typing из header, оставив стабильный presence.
4. Сделать ссылки кликабельными и привести timestamp/status/hover actions к одному meta-слою.
5. Увеличить profile labels/help и исправить «Имя»/fixed `@` без изменения backend model.

### 3. Какой экран полировать первым

Историю чата. Это самый частый экран, изменения сразу заметны в каждом разговоре, а основа уже работает. Здесь можно получить сильный результат без WebRTC, Electron или backend rewrite.

### 4. Какие задачи пока не трогать

Не смешивать с первым polish-pass: PWA push, offline architecture, persistent cache, cursor/pagination, TURN, noise suppression, 5 FPS/ping, автоматическую desktop activity и полный custom titlebar. Также link preview лучше делать после обычных безопасных clickable links.

### 5. Что нужно для ощущения «1.0»

Не максимальное число функций, а последовательность:

- основной чат следует одному правилу времени, grouping, avatar и states;
- composer и emoji не выглядят временными;
- звонок одинаково понятен с камерой, экраном и без media;
- profile/presence не противоречат sidebar/header;
- все focus/error/loading состояния выглядят намеренно;
- Windows и mobile имеют собственный законченный shell;
- критические technical gaps из `MOVA_TECHNICAL_ROADMAP.md` закрываются отдельным reliability-track.

После этапов 1–4 Mova уже должна визуально восприниматься как цельный продукт. Этапы 5–7 превращают это ощущение в platform-level 1.0.

### 6. Что проверить глазами после первого этапа

1. Понятно ли без размышлений, где закончился один авторский блок и начался другой.
2. Не прыгает ли горизонтальная позиция bubbles внутри группы.
3. Нет ли avatars в DM и стоит ли group avatar у нижнего сообщения блока.
4. Видны ли границы дней при быстром скролле.
5. Не конкурируют ли username, timestamp, delivery status и reply за внимание.
6. Открываются ли links мышью и клавиатурой, не ломая длинный текст.
7. Появляются ли hover actions без скачка bubble и доступны ли они с клавиатуры.
8. Остался ли header стабильным, когда собеседник печатает.
9. Выглядят ли sending, failed, sent и read как состояния одной системы.
10. Комфортно ли читать чат 10–15 минут подряд на обычной desktop-ширине и на 390 px.

## Definition of done для каждого polish-этапа

- Scope ограничен одним экраном или связанным набором компонентов.
- Нет новых случайных токенов без роли.
- Mouse, keyboard, focus-visible, disabled и reduced motion проверены.
- Есть ручная проверка desktop + narrow viewport.
- Сохранены существующие data/realtime/call semantics.
- Перекрытые CSS-правила удаляются только в затронутой области; нет глобального rewrite.
- До/после можно объяснить владельцу продукта одним предложением и увидеть глазами за минуту.
