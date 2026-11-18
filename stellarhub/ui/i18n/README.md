# Translations

StellarHub is written in English and translated into Spanish (`es`), Portuguese – Brazil (`pt`), Italian (`it`),
French (`fr`) and Simplified Chinese (`zh`).

## How it works

- Each language has one JSON file per area: `stellarhub/ui/i18n/<lang>/<area>.json`, a flat object
  `{ "English text": "translation" }`. Areas: `common`, `shell`, `home`, `sheet`, `widget`, `monitor`, `drivers`,
  `remover`, `updater`, `storage`, `optimizer`, `tester`, `autopilot`, `model3d`, `engine`. The same key may appear
  in several areas; all files of a language are merged, so keep a repeated key's translation identical.
- **Interface (JavaScript):** `SH.t('Scan the disk')`, `SH.t('{n} of {total} keys', { n, total })`.
  `js/i18n.js` loads the dictionaries before any other script, so `SH.t` also works in top-level constants.
- **Engine (Python):** `from ..i18n import tr` (or `from ...i18n import tr` inside `engine/removal/`), then
  `tr("Reading the drivers…")`, `tr("{name} could not be removed.", name=x)` (str.format placeholders, by name).
- Unknown text comes back in English, so a missing entry never breaks anything.
- The language is the `language` setting: `auto` (Windows display language) or a code. Changing it reloads the
  interface; the engine, widget and tray follow.

## Rules for wrapping

- Wrap every sentence the user can read: labels, buttons, tooltips (`title`), `aria-label`, placeholders, toasts,
  empty states, errors, job progress and log lines shown in the UI, explanations, catalog names and descriptions.
- One key per complete sentence or label. Never build a sentence from translated fragments ("Found " + n + "
  files"): use placeholders, so word order can change: `t('Found {n} files', { n })`.
- Plurals: keep the code's existing choice between two keys (`n === 1 ? t('{n} file', {n}) : t('{n} files', {n})`).
- Keep HTML out of keys when possible (`<b>${t('Name')}</b>`). If a sentence has inline markup in the middle, the
  key may contain simple tags (`<b>`, `<i>`, `<br>`), and the translation must keep exactly the same tags.
- Do not translate: StellarHub, Windows and other product or company names (NVIDIA, winget, Microsoft Store,
  WebView2, SMART, BIOS…), file names, paths, registry keys, commands, units (GB, MB/s, %, °C, Hz, rpm, ms, W),
  keyboard keys (Ctrl, Alt, Esc…), technical identifiers, values the code compares or parses, settings keys,
  and console/debug-only messages (print, log files).
- Never translate a string the code later compares (`if (btn.textContent === 'Pause')`): compare a data attribute
  or state instead, and translate only what is displayed.
- Numbers: use `SH.fmt1` / `SH.fmtInt` (they follow the language: `1.234,5` in Spanish). Never parse displayed
  text back into numbers.
- Placeholders inside a translation keep exactly the same `{names}`.
- Translations are inserted as HTML in many places: do not introduce `<`, `>` or `&` that the English key lacks.

## Tone

| | Address | Style |
|---|---|---|
| es | tú | Spain Spanish, natural and short, like Windows 11 in Spanish but warmer |
| pt | você | Brazilian Portuguese |
| it | tu | |
| fr | vous | |
| zh | 你 | Simplified Chinese, concise; no spaces between Chinese characters, a space between Chinese and Latin text/numbers is fine |

Short labels stay short (buttons, tabs, chips must fit). Sentence case as in English (no Title Case).

## Glossary

| English | es | pt | it | fr | zh |
|---|---|---|---|---|---|
| Home | Inicio | Início | Home | Accueil | 主页 |
| Live Monitor | Monitor en vivo | Monitor ao vivo | Monitor in tempo reale | Moniteur en direct | 实时监控 |
| Driver Updater | Actualizador de controladores | Atualizador de drivers | Aggiornamento driver | Mise à jour des pilotes | 驱动更新 |
| Program Remover | Desinstalador de programas | Removedor de programas | Rimozione programmi | Désinstallateur | 程序卸载 |
| Program Updater | Actualizador de programas | Atualizador de programas | Aggiornamento programmi | Mise à jour des programmes | 程序更新 |
| Storage Checker | Analizador de almacenamiento | Analisador de armazenamento | Analisi dello spazio | Analyseur de stockage | 存储分析 |
| Super Optimizer | Superoptimizador | Superotimizador | Super ottimizzatore | Super optimiseur | 超级优化 |
| Device Tester | Probador de dispositivos | Testador de dispositivos | Test dei dispositivi | Testeur de périphériques | 设备测试 |
| Autopilot | Piloto automático | Piloto automático | Pilota automatico | Pilote automatique | 自动维护 |
| Settings | Ajustes | Configurações | Impostazioni | Paramètres | 设置 |
| Administrator mode | Modo administrador | Modo administrador | Modalità amministratore | Mode administrateur | 管理员模式 |
| Normal mode | Modo normal | Modo normal | Modalità normale | Mode normal | 普通模式 |
| widget | widget | widget | widget | widget | 小组件 |
| tray (notification area) | bandeja del sistema | bandeja do sistema | area di notifica | zone de notification | 系统托盘 |
| driver | controlador | driver | driver | pilote | 驱动程序 |
| update (noun / verb) | actualización / actualizar | atualização / atualizar | aggiornamento / aggiornare | mise à jour / mettre à jour | 更新 |
| install / uninstall | instalar / desinstalar | instalar / desinstalar | installare / disinstallare | installer / désinstaller | 安装 / 卸载 |
| scan (verb / noun) | analizar / análisis | verificar / verificação | analizzare / analisi | analyser / analyse | 扫描 |
| clean / cleanup | limpiar / limpieza | limpar / limpeza | pulire / pulizia | nettoyer / nettoyage | 清理 |
| leftovers | restos | resíduos | residui | restes | 残留项 |
| quarantine | cuarentena | quarentena | quarantena | quarantaine | 隔离区 |
| restore point | punto de restauración | ponto de restauração | punto di ripristino | point de restauration | 还原点 |
| backup | copia de seguridad | backup | backup | sauvegarde | 备份 |
| startup apps | aplicaciones de inicio | apps de inicialização | app all'avvio | applications au démarrage | 启动项 |
| service | servicio | serviço | servizio | service | 服务 |
| registry | registro | registro | registro di sistema | registre | 注册表 |
| free space | espacio libre | espaço livre | spazio libero | espace libre | 可用空间 |
| routine (Autopilot) | rutina | rotina | routine | routine | 例程 |
| trigger / condition / action | disparador / condición / acción | gatilho / condição / ação | attivatore / condizione / azione | déclencheur / condition / action | 触发器 / 条件 / 操作 |
| dry run | prueba en seco | simulação | prova a secco | simulation | 试运行 |
| Undo | Deshacer | Desfazer | Annulla | Annuler | 撤销 |
| Cancel | Cancelar | Cancelar | Annulla | Annuler | 取消 |
| Turn on / Turn off | Activar / Desactivar | Ativar / Desativar | Attiva / Disattiva | Activer / Désactiver | 开启 / 关闭 |
| health | salud | integridade | stato | état | 健康状况 |
| usage (CPU…) | uso | uso | utilizzo | utilisation | 占用率 |
| temperature | temperatura | temperatura | temperatura | température | 温度 |
| processes | procesos | processos | processi | processus | 进程 |
| graphics card | tarjeta gráfica | placa de vídeo | scheda video | carte graphique | 显卡 |
| memory (RAM) | memoria | memória | memoria | mémoire | 内存 |
| disk | disco | disco | disco | disque | 磁盘 |
