#!/usr/bin/env node

// ── Auto-bootstrap ────────────────────────────────────────────
const { execSync } = require('child_process');
(function ensureDeps() {
  const needed = [
    'chalk', 'boxen', 'log-update', 'inquirer', 'https-proxy-agent',
    'bing-translate-api', '@vitalets/google-translate-api',
  ];
  const missing = needed.filter(m => {
    try { require.resolve(m); return false; } catch { return true; }
  });
  if (missing.length === 0) return;
  console.log('\n  \u2699  First run detected — installing dependencies...\n');
  try {
    execSync('npm install --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' });
    console.log('\n  \u2714  Dependencies installed! Starting...\n');
  } catch (e) {
    console.error('\n  \u2716  Failed to install dependencies. Run "npm install" manually.\n');
    process.exit(1);
  }
})();

// ── Deps & config ────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const boxen = require('boxen');
const logUpdate = require('log-update');
const inquirer = require('inquirer');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ARGS = process.argv.slice(2);
const FLAG_DRY_RUN = ARGS.includes('--dry-run');
const FLAG_LOG = ARGS.includes('--log');

const getArgValue = (flag) => {
  const idx = ARGS.indexOf(flag);
  return idx !== -1 && ARGS[idx + 1] ? ARGS[idx + 1] : null;
};

const ARG_LLM_URL = getArgValue('--llm-url');
const ARG_LLM_KEY = getArgValue('--llm-key');
const ARG_LLM_MODEL = getArgValue('--llm-model');

const PROXY_ENV = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
const PROXY_URL = PROXY_ENV || '';
const LANG_NAMES = { en: 'English', ru: 'Russian', ja: 'Japanese', ko: 'Korean', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', ar: 'Arabic' };

// Bing uses zh-Hans/zh-Hant, Google uses zh-CN/zh-TW — map between them
const GOOGLE_LANG_MAP = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };
const toGoogleLang = code => GOOGLE_LANG_MAP[code] || code;

const delay = ms => new Promise(res => setTimeout(res, ms));
const hasZh = t => /[\u3400-\u9fff\uf900-\ufaff]/.test(t);
const fmtTime = (sec) => {
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ── Config & Glossary ────────────────────────────────────────
const CONFIG_FILE = '.translaterc.json';
const GLOSSARY_FILE = 'glossary.json';
const CONCURRENCY = { bing: 3, google: 3, llm: 5 };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadGlossary() {
  try {
    if (fs.existsSync(GLOSSARY_FILE)) return JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

function saveGlossary(glossary) {
  fs.writeFileSync(GLOSSARY_FILE, JSON.stringify(glossary, null, 2));
}

const savedConfig = loadConfig();
let glossary = loadGlossary();
let currentLang = savedConfig.lang || 'en';

// ── i18n ─────────────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    step1: '📁 Select Preset', step2: '⚙️  Translation Engine',
    step3: '🗣️  Source Language', step4: '🎯 Target Language',
    step5: '🔧 Options', step6: '✅ Confirm',
    noPresets: 'No preset JSON files found in current directory.',
    msgPreset: 'Preset:', promptsLabel: 'prompts',
    msgPrimary: 'Primary:', msgFallback: 'Fallback:', fallbackNone: 'None',
    engBingDesc: 'free · no key · fast', engGoogleDesc: 'free · no key · accurate', engLlmDesc: 'API key · best quality',
    llmConfigTitle: '── LLM Configuration ──', llmUrl: 'API URL:', llmKey: 'API Key:', llmModel: 'Model:  ',
    msgFrom: 'From:', msgTo: 'To:  ', langOther: 'Other', msgLangCode: 'Language code:',
    msgOptionsToggle: 'Toggle:', optDryRun: 'Dry run', optDryRunHint: '(analyze only, no API calls)',
    optLog: 'Log to file', optGlossary: 'Edit glossary',
    glossEditorTitle: '📖 Glossary Editor',
    glossEditorDesc: 'Terms are protected from translation and replaced with target text',
    glossAction: 'Action:', glossAdd: 'Add term', glossRemove: 'Remove term', glossDone: 'Done',
    glossSrcTerm: 'Source term:', glossTranslation: 'Translation:',
    glossEmpty: 'Empty glossary', glossSaved: 'Glossary saved',
    summaryFile: 'File', summaryEngine: 'Engine', summaryLang: 'Language',
    summaryPrompts: 'Prompts', summaryTotal: 'total', summaryToTranslate: 'to translate',
    summaryGlossary: 'Glossary', summaryTerms: 'terms', summaryTitle: ' Summary ',
    msgStartQuestion: 'Start translation?', msgCancelled: 'Cancelled.',
    dashTitle: 'HHS1e Translation Engine', dashEngine: 'Engine', dashProxy: 'Proxy',
    dashProxyOn: 'ON', dashProxyOff: 'OFF', dashLang: 'Lang',
    dashGlossary: 'Glossary', dashGlossaryNone: 'none', dashGlossaryTerms: 'terms',
    dashFile: 'File', dashResumed: 'resumed:', dashRecent: '─── Recent ───────────────────────────',
    dashElapsed: 'Elapsed', dashEta: 'ETA', dashWaiting: 'waiting...', dashCalculating: 'calculating...',
    dashTranslated: 'translated', dashSkipped: 'skipped', dashFailed: 'failed',
    doneTitle: ' Done ', doneBanner: 'Translation Complete!',
    doneFile: 'File', doneSize: 'Size', doneTime: 'Time', doneResults: 'Results', doneSuccess: '% success',
    doneTranslated: 'translated', doneSkipped: 'skipped', doneFailed: 'failed',
    interrupted: 'Interrupted — progress saved', sigintFile: 'File', sigintTime: 'Time',
    dryTitle: '  Dry Run Analysis', dryScanTitle: ' Scan ', dryReady: 'ready', dryNames: 'names', dryContents: 'contents',
    saveSettings: 'Save settings for next time?', settingsSaved: 'Settings saved to',
    reviewOrig: 'ORIGINAL:', reviewTrans: 'TRANSLATED:',
    reviewNext: 'Next', reviewRetry: 'Mark for retry', reviewQuit: 'Quit review', reviewDone: 'Saved.',
    reviewQuestion: 'Review %d translated prompts?', reviewMarked: 'Marked #%d for retry', reviewRetrying: 'Retrying %d prompts...',
    regexPhase: '── Translating regex scripts ──────────────────────────────────────',
    regexScripts: 'Regex scripts',
    fieldsLabel: 'fields',
    ccPhase: '── Translating character card ─────────────────────────────────────',
    ccField: 'Field', ccGreeting: 'Greeting', ccLorebook: 'Lorebook',
    ccAltGreeting: 'alternate greeting', ccLorebookEntry: 'lorebook entry',
    summaryFields: 'Fields', noFiles: 'No translatable JSON files found in current directory.',
  },
  ru: {
    step1: '📁 Выбор пресета', step2: '⚙️  Движок перевода',
    step3: '🗣️  Исходный язык', step4: '🎯 Язык перевода',
    step5: '🔧 Параметры', step6: '✅ Подтверждение',
    noPresets: 'Файлы пресетов JSON не найдены в текущей директории.',
    msgPreset: 'Пресет:', promptsLabel: 'промптов',
    msgPrimary: 'Основной:', msgFallback: 'Резерв:', fallbackNone: 'Нет',
    engBingDesc: 'бесплатно · без ключа · быстро', engGoogleDesc: 'бесплатно · без ключа · точно', engLlmDesc: 'API ключ · высокое качество',
    llmConfigTitle: '── Настройка LLM ──', llmUrl: 'URL API:', llmKey: 'API ключ:', llmModel: 'Модель: ',
    msgFrom: 'Откуда:', msgTo: 'Куда:  ', langOther: 'Другой', msgLangCode: 'Код языка:',
    msgOptionsToggle: 'Опции:', optDryRun: 'Пробный запуск', optDryRunHint: '(анализ без обращений к API)',
    optLog: 'Лог в файл', optGlossary: 'Редактировать глоссарий',
    glossEditorTitle: '📖 Редактор глоссария',
    glossEditorDesc: 'Термины защищены от перевода и заменяются целевым текстом',
    glossAction: 'Действие:', glossAdd: 'Добавить термин', glossRemove: 'Удалить термин', glossDone: 'Готово',
    glossSrcTerm: 'Исходный термин:', glossTranslation: 'Перевод:',
    glossEmpty: 'Глоссарий пуст', glossSaved: 'Глоссарий сохранён',
    summaryFile: 'Файл', summaryEngine: 'Движок', summaryLang: 'Язык',
    summaryPrompts: 'Промптов', summaryTotal: 'всего', summaryToTranslate: 'к переводу',
    summaryGlossary: 'Глоссарий', summaryTerms: 'терминов', summaryTitle: ' Итого ',
    msgStartQuestion: 'Начать перевод?', msgCancelled: 'Отменено.',
    dashTitle: 'HHS1e · Движок перевода', dashEngine: 'Движок', dashProxy: 'Прокси',
    dashProxyOn: 'ВКЛ', dashProxyOff: 'ВЫКЛ', dashLang: 'Язык',
    dashGlossary: 'Глоссарий', dashGlossaryNone: 'нет', dashGlossaryTerms: 'терм.',
    dashFile: 'Файл', dashResumed: 'продолжено:', dashRecent: '─── Последние ─────────────────────────',
    dashElapsed: 'Прошло', dashEta: 'Осталось', dashWaiting: 'ожидание...', dashCalculating: 'вычисляем...',
    dashTranslated: 'переведено', dashSkipped: 'пропущено', dashFailed: 'ошибок',
    doneTitle: ' Готово ', doneBanner: 'Перевод завершён!',
    doneFile: 'Файл', doneSize: 'Размер', doneTime: 'Время', doneResults: 'Результат', doneSuccess: '% успешно',
    doneTranslated: 'переведено', doneSkipped: 'пропущено', doneFailed: 'ошибок',
    interrupted: 'Прервано — прогресс сохранён', sigintFile: 'Файл', sigintTime: 'Время',
    dryTitle: '  Анализ (пробный запуск)', dryScanTitle: ' Скан ', dryReady: 'готово', dryNames: 'имён', dryContents: 'содержимого',
    saveSettings: 'Сохранить настройки для следующего запуска?', settingsSaved: 'Настройки сохранены в',
    reviewOrig: 'ОРИГИНАЛ:', reviewTrans: 'ПЕРЕВОД:',
    reviewNext: 'Далее', reviewRetry: 'Отметить для повтора', reviewQuit: 'Выйти из просмотра', reviewDone: 'Сохранено.',
    reviewQuestion: 'Просмотреть %d переведённых промптов?', reviewMarked: 'Отмечен #%d для повтора', reviewRetrying: 'Повтор %d промптов...',
    regexPhase: '── Перевод regex-скриптов ─────────────────────────────────────────',
    regexScripts: 'Regex-скрипты',
    fieldsLabel: 'полей',
    ccPhase: '── Перевод карточки персонажа ─────────────────────────────────────',
    ccField: 'Поле', ccGreeting: 'Приветствие', ccLorebook: 'Лорбук',
    ccAltGreeting: 'альт. приветствие', ccLorebookEntry: 'запись лорбука',
    summaryFields: 'Полей', noFiles: 'Переводимые JSON-файлы не найдены в текущей директории.',
  },
  zh: {
    step1: '📁 选择预设', step2: '⚙️  翻译引擎',
    step3: '🗣️  源语言', step4: '🎯 目标语言',
    step5: '🔧 选项', step6: '✅ 确认',
    noPresets: '当前目录中未找到预设 JSON 文件。',
    msgPreset: '预设：', promptsLabel: '个提示词',
    msgPrimary: '主引擎：', msgFallback: '备用：', fallbackNone: '无',
    engBingDesc: '免费 · 无需密钥 · 快速', engGoogleDesc: '免费 · 无需密钥 · 准确', engLlmDesc: 'API 密钥 · 最佳质量',
    llmConfigTitle: '── LLM 配置 ──', llmUrl: 'API 地址：', llmKey: 'API 密钥：', llmModel: '模型：   ',
    msgFrom: '源语言：', msgTo: '目标：  ', langOther: '其他', msgLangCode: '语言代码：',
    msgOptionsToggle: '选项：', optDryRun: '试运行', optDryRunHint: '（仅分析，不调用 API）',
    optLog: '记录到文件', optGlossary: '编辑词汇表',
    glossEditorTitle: '📖 词汇表编辑器',
    glossEditorDesc: '词汇表中的术语将受保护，不会被翻译，而是替换为目标文本',
    glossAction: '操作：', glossAdd: '添加术语', glossRemove: '删除术语', glossDone: '完成',
    glossSrcTerm: '源术语：', glossTranslation: '译文：',
    glossEmpty: '词汇表为空', glossSaved: '词汇表已保存',
    summaryFile: '文件', summaryEngine: '引擎', summaryLang: '语言',
    summaryPrompts: '提示词', summaryTotal: '共', summaryToTranslate: '待翻译',
    summaryGlossary: '词汇表', summaryTerms: '个术语', summaryTitle: ' 摘要 ',
    msgStartQuestion: '开始翻译？', msgCancelled: '已取消。',
    dashTitle: 'HHS1e 翻译引擎', dashEngine: '引擎', dashProxy: '代理',
    dashProxyOn: '开', dashProxyOff: '关', dashLang: '语言',
    dashGlossary: '词汇表', dashGlossaryNone: '无', dashGlossaryTerms: '个术语',
    dashFile: '文件', dashResumed: '已恢复：', dashRecent: '─── 最近 ─────────────────────────────',
    dashElapsed: '已用时', dashEta: '预计剩余', dashWaiting: '等待中...', dashCalculating: '计算中...',
    dashTranslated: '已翻译', dashSkipped: '已跳过', dashFailed: '失败',
    doneTitle: ' 完成 ', doneBanner: '翻译完成！',
    doneFile: '文件', doneSize: '大小', doneTime: '耗时', doneResults: '结果', doneSuccess: '% 成功',
    doneTranslated: '已翻译', doneSkipped: '已跳过', doneFailed: '失败',
    interrupted: '已中断 — 进度已保存', sigintFile: '文件', sigintTime: '时间',
    dryTitle: '  试运行分析', dryScanTitle: ' 扫描 ', dryReady: '就绪', dryNames: '个名称', dryContents: '个内容',
    saveSettings: '保存设置以供下次使用？', settingsSaved: '设置已保存至',
    reviewOrig: '原文：', reviewTrans: '译文：',
    reviewNext: '下一个', reviewRetry: '标记为重试', reviewQuit: '退出审阅', reviewDone: '已保存。',
    reviewQuestion: '查看 %d 个已翻译的提示词？', reviewMarked: '已标记 #%d 重试', reviewRetrying: '正在重试 %d 个提示词...',
    regexPhase: '── 正在翻译正则脚本 ────────────────────────────────────────────────',
    regexScripts: '正则脚本',
    fieldsLabel: '个字段',
    ccPhase: '── 正在翻译角色卡 ──────────────────────────────────────────────────',
    ccField: '字段', ccGreeting: '问候语', ccLorebook: '世界书',
    ccAltGreeting: '备选问候', ccLorebookEntry: '世界书条目',
    summaryFields: '字段', noFiles: '当前目录中未找到可翻译的 JSON 文件。',
  },
};

function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) || TRANSLATIONS.en[key] || key;
}

function drawLogo() {
  const g = [chalk.cyanBright, chalk.cyan, chalk.blueBright, chalk.blue, chalk.blueBright, chalk.blue];
  const logo = [
    g[0]('  ███████╗') + g[0]('  ██████╗ ') + g[1]('  ████████╗') + g[2]('  ███████╗'),
    g[0]('  ██╔════╝') + g[0]('  ██╔══██╗') + g[1]('  ╚══██╔══╝') + g[2]('  ██╔════╝'),
    g[1]('  ███████╗') + g[1]('  ██████╔╝') + g[2]('     ██║   ') + g[3]('  █████╗  '),
    g[2]('  ╚════██╗') + g[2]('  ██╔═══╝ ') + g[3]('     ██║   ') + g[4]('  ██╔══╝  '),
    g[3]('  ███████║') + g[3]('  ██║     ') + g[4]('     ██║   ') + g[5]('  ███████╗'),
    g[4]('  ╚══════╝') + g[4]('  ╚═╝     ') + g[5]('     ╚═╝   ') + g[5]('  ╚══════╝'),
  ];
  console.log();
  logo.forEach(l => console.log(l));
  console.log();
  console.log(boxen(
    chalk.white.bold('SillyTavern Preset Translation Engine') + '\n' +
    chalk.gray('v1.0') + chalk.gray('  ·  ') +
    chalk.cyan('Bing') + chalk.gray(' / ') + chalk.red('Google') + chalk.gray(' / ') + chalk.magenta('LLM') +
    chalk.gray('  ·  Cascade  ·  Glossary  ·  Parallel'),
    { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderColor: 'cyan', borderStyle: 'round', dimBorder: true }
  ));
  console.log();
}

async function selectInterfaceLang() {
  const { lang } = await inquirer.prompt([{
    type: 'list', name: 'lang',
    message: 'Language / Язык / 语言:',
    prefix: '  ',
    choices: [
      { name: '  🇬🇧  English', value: 'en', short: 'EN' },
      { name: '  🇷🇺  Русский', value: 'ru', short: 'RU' },
      { name: '  🇨🇳  中文',    value: 'zh', short: 'ZH' },
    ],
    default: savedConfig.lang || 'en',
  }]);
  currentLang = lang;
  console.log();
}

let proxyAgents = undefined;
let undiciProxyDispatcher = undefined;
if (PROXY_ENV) {
  try {
    const agent = new HttpsProxyAgent(PROXY_URL);
    proxyAgents = { https: agent };
    // For Node native fetch() — use undici ProxyAgent if available
    try {
      const { ProxyAgent } = require('undici');
      undiciProxyDispatcher = new ProxyAgent(PROXY_URL);
    } catch (e) { /* undici not available — LLM will connect directly */ }
  } catch (e) {}
}

// ── Translator ───────────────────────────────────────────────

function createTranslator(engine, fromLang, toLang, llmConfig) {
  if (engine === 'bing') {
    const { translate } = require('bing-translate-api');
    return async (text) => {
      const res = await translate(text, fromLang, toLang, false, false, undefined, proxyAgents);
      return res.translation;
    };
  }

  if (engine === 'google') {
    const { translate } = require('@vitalets/google-translate-api');
    const fetchOptions = proxyAgents ? { agent: proxyAgents.https } : {};
    return async (text) => {
      const res = await translate(text, { from: toGoogleLang(fromLang), to: toGoogleLang(toLang), fetchOptions });
      return res.text;
    };
  }

  if (engine === 'llm') {
    const { url, key, model } = llmConfig;
    const fromName = LANG_NAMES[fromLang] || fromLang;
    const toName = LANG_NAMES[toLang] || toLang;
    const sysPrompt = [
      `You are a professional ${fromName}→${toName} translator specializing in creative writing and roleplay system prompts.`,
      ``,
      `## Task`,
      `Translate the user's text from ${fromName} to ${toName}.`,
      ``,
      `## Critical rules`,
      `1. The text contains numeric codes like 91740001, 91740023 etc. These are PROTECTED PLACEHOLDERS. Copy them exactly as-is, digit for digit. Never modify, reorder, split, or add spaces inside them.`,
      `2. Preserve all formatting: line breaks, indentation, blank lines, bullet points, numbered lists.`,
      `3. Preserve any XML/HTML tags verbatim (e.g. <div>, <example>, </instructions>).`,
      `4. Do NOT add any commentary, notes, or explanations. Output ONLY the translated text.`,
      `5. Do NOT wrap output in code blocks or quotes.`,
      `6. Translate meaning and intent, not word-for-word. Adapt idioms naturally to ${toName}.`,
      `7. If a segment is already in ${toName}, pass it through unchanged.`,
    ].join('\n');

    return async (text) => {
      const fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(120000),
      };
      if (undiciProxyDispatcher) fetchOpts.dispatcher = undiciProxyDispatcher;
      const resp = await fetch(url.replace(/\/+$/, '') + '/chat/completions', fetchOpts);
      if (!resp.ok) throw new Error(`LLM API ${resp.status}: ${await resp.text()}`);
      const data = await resp.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error(`LLM API returned empty response: ${JSON.stringify(data).substring(0, 200)}`);
      }
      return data.choices[0].message.content.trim();
    };
  }

  throw new Error(`Unknown engine: ${engine}`);
}

async function translateSmart(text, translateFn, depth = 0) {
  if (!text || !text.trim()) return text;
  if (!hasZh(text)) return text;

  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await translateFn(text); }
    catch (e) {
      lastErr = e;
      const tag = depth > 0 ? `smart:d${depth}` : 'smart';
      state.currentDetail = `${tag} retry ${i+1}/3: ${e.message.substring(0, 60)}`;
      if (i < 2) await delay(2000 * (i + 1));
    }
  }

  if (text.length < 100 || depth > 5) {
    addRecentLog('⚠', `give up ${text.length}ch: ${(lastErr||{}).message||'?'}`.substring(0, 60));
    return text;
  }

  const mid = Math.floor(text.length / 2);
  let splitAt = text.lastIndexOf('\n', mid);
  if (splitAt < text.length * 0.2) splitAt = mid;

  const t1 = await translateSmart(text.substring(0, splitAt), translateFn, depth + 1);
  await delay(1500);
  const t2 = await translateSmart(text.substring(splitAt), translateFn, depth + 1);
  return t1 + t2;
}

async function translateContent(content, translateFn, chunkSize, logger, glossaryMap, concurrency) {
  const commentRe = /\{\{\/\/([\s\S]*?)\}\}/g;
  let match;
  const originalContent = content; // true original for fallback on validation failure
  const commentOriginals = [];
  let commentContent = content;

  while ((match = commentRe.exec(content)) !== null) {
    if (hasZh(match[1])) {
      commentOriginals.push({ full: match[0], inner: match[1], index: match.index });
    }
  }
  // Translate comments in reverse order so index positions stay valid
  for (let ci = commentOriginals.length - 1; ci >= 0; ci--) {
    const c = commentOriginals[ci];
    try {
      const translated = await translateSmart(c.inner, translateFn);
      commentContent = commentContent.substring(0, c.index) + `{{//${translated}}}` + commentContent.substring(c.index + c.full.length);
      await delay(800);
    } catch (e) { /* keep original */ }
  }

  const glossaryPh = {};
  let gCnt = 0;
  let glossaryText = commentContent;
  if (glossaryMap && Object.keys(glossaryMap).length > 0) {
    // Sort by length descending to avoid partial matches
    const sorted = Object.keys(glossaryMap).sort((a, b) => b.length - a.length);
    for (const term of sorted) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      glossaryText = glossaryText.replace(re, () => {
        const id = '9176' + String(gCnt++).padStart(4, '0');
        glossaryPh[id] = glossaryMap[term];
        return id;
      });
    }
  }

  const placeholders = {};
  let counter = 0;
  const PH_PREFIX = '9174';
  function protect(regex, text) {
    return text.replace(regex, m => {
      const id = PH_PREFIX + String(counter++).padStart(4, '0');
      placeholders[id] = m;
      return id;
    });
  }

  let pt = glossaryText;
  pt = protect(/\{\{set(?:global)?var::[^:]+::/g, pt);
  pt = protect(/\{\{get(?:global)?var::[^}]+\}\}/g, pt);
  pt = protect(/\{\{addvar::[^:]+::/g, pt);
  pt = protect(/\{\{(?:inc|dec)var::[^}]+\}\}/g, pt);
  pt = protect(/\{\{\/\/[\s\S]*?\}\}/g, pt);
  pt = protect(/\{\{random::[\s\S]*?\}\}/g, pt);
  pt = protect(/\{\{roll:[^}]+\}\}/g, pt);
  pt = protect(/\{\{(?:user|char|uuid|trim|lastUserMessage|LastUserMessage|group|scenario|personality|序号，如01|日期|时间|地点|天气)\}\}/gi, pt);
  pt = protect(/\{\{format_message_variable::[^}]+\}\}/g, pt);
  // Protect Handlebars-style macros ({{#if}}, {{/if}}, {{#each}}, {{else}}, etc.)
  pt = protect(/\{\{[#/][\w]+(?:\s[^}]*)?\}\}/g, pt);
  pt = protect(/\{\{else\}\}/gi, pt);
  // Protect any remaining opening {{ (catch-all for unrecognized macros)
  pt = protect(/\{\{/g, pt);
  pt = protect(/\}\}/g, pt);
  pt = protect(/<[^>]+>/g, pt);
  pt = protect(/^#{1,6}\s/gm, pt);
  pt = protect(/https?:\/\/[^\s]+/g, pt);
  // Translate Chinese inside backtick blocks before protecting them
  const btBlockRe = /(```\w*\r?\n)([\s\S]*?)(\r?\n\s*```)/g;
  let btM;
  const btReps = [];
  while ((btM = btBlockRe.exec(pt)) !== null) {
    if (hasZh(btM[2])) btReps.push({ start: btM.index, end: btM.index + btM[0].length, pre: btM[1], inner: btM[2], suf: btM[3] });
  }
  for (let bi = btReps.length - 1; bi >= 0; bi--) {
    const b = btReps[bi];
    try {
      const tr = await translateSmart(b.inner, translateFn);
      pt = pt.substring(0, b.start) + b.pre + tr + b.suf + pt.substring(b.end);
    } catch (e) { /* keep original on error */ }
  }
  pt = protect(/```[\s\S]*?```/g, pt);
  pt = protect(/`[^`]+`/g, pt);
  pt = protect(/\$\$[\s\S]*?\$\$/g, pt);
  pt = protect(/\$[^$\n]+\$/g, pt);
  pt = protect(/^\|.*\|$/gm, pt);
  pt = protect(/style="[^"]*"/g, pt);

  const chunks = [];
  const lines = pt.split('\n');
  let cur = '';
  for (const line of lines) {
    if (cur.length + line.length + 1 > chunkSize && cur.length > 0) {
      chunks.push(cur);
      cur = line;
    } else {
      cur += (cur ? '\n' : '') + line;
    }
  }
  if (cur) chunks.push(cur);

  const maxConcurrent = concurrency || 3;
  const translatedChunks = new Array(chunks.length);
  let running = 0;
  let resolveSlot = null;

  function waitForSlot() {
    if (running < maxConcurrent) return Promise.resolve();
    return new Promise(resolve => { resolveSlot = resolve; });
  }

  function releaseSlot() {
    running--;
    if (resolveSlot) { const r = resolveSlot; resolveSlot = null; r(); }
  }

  const tasks = [];
  for (let c = 0; c < chunks.length; c++) {
    if (!hasZh(chunks[c])) { translatedChunks[c] = chunks[c]; continue; }

    const idx = c;
    await waitForSlot();
    running++;
    const task = (async () => {
      try {
        if (logger) logger(`chunk ${idx + 1}/${chunks.length}`);
        translatedChunks[idx] = await translateSmart(chunks[idx], translateFn);
      } catch (e) {
        translatedChunks[idx] = chunks[idx]; // keep original on error
      } finally {
        releaseSlot();
      }
    })();
    tasks.push(task);
  }
  await Promise.all(tasks);
  let translated = translatedChunks.join('\n');

  const sortedIds = Object.keys(placeholders).sort((a, b) => b.length - a.length);
  for (const id of sortedIds) {
    translated = translated.split(id).join(placeholders[id]);
  }

  // fuzzy restore — handle spaces inserted between digits by translator
  const usedIds = new Set(Object.keys(placeholders));
  for (const id of sortedIds) {
    const fuzzyRe = new RegExp(id.split('').map(ch => ch + '\\s*').join(''), 'g');
    translated = translated.replace(fuzzyRe, m => {
      const cleaned = m.replace(/\s/g, '');
      return cleaned === id ? placeholders[id] : m;
    });
  }

  const gSortedIds = Object.keys(glossaryPh).sort((a, b) => b.length - a.length);
  for (const id of gSortedIds) {
    translated = translated.split(id).join(glossaryPh[id]);
  }
  // Fuzzy restore for glossary too
  for (const id of gSortedIds) {
    const fuzzyRe = new RegExp(id.split('').map(ch => ch + '\\s*').join(''), 'g');
    translated = translated.replace(fuzzyRe, m => m.replace(/\s/g, '') === id ? glossaryPh[id] : m);
  }

  const remaining = (translated.match(/9174\d{4,}/g) || []).filter(m => usedIds.has(m));
  const origOpens = (originalContent.match(/\{\{/g) || []).length;
  const origCloses = (originalContent.match(/\}\}/g) || []).length;
  const transOpens = (translated.match(/\{\{/g) || []).length;
  const transCloses = (translated.match(/\}\}/g) || []).length;

  if (remaining.length > 0) {
    return { ok: false, reason: `${remaining.length} unreplaced placeholders`, content: originalContent };
  }
  if (transOpens !== transCloses) {
    return { ok: false, reason: `unbalanced macros ({{ ${transOpens} vs }} ${transCloses})`, content: originalContent };
  }
  if (origOpens !== transOpens || origCloses !== transCloses) {
    return { ok: false, reason: `macro count changed (${origOpens}/${origCloses} → ${transOpens}/${transCloses})`, content: originalContent };
  }
  return { ok: true, content: translated };
}

// ── Linewise fallback ─────────────────────────────────────────
async function translateContentLinewise(content, translateFn, logger, concurrency, glossaryMap) {
  // Apply glossary protection before line-by-line translation
  const glossaryPh = {};
  let gCnt = 0;
  let glossaryContent = content;
  if (glossaryMap && Object.keys(glossaryMap).length > 0) {
    const sorted = Object.keys(glossaryMap).sort((a, b) => b.length - a.length);
    for (const term of sorted) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'g');
      glossaryContent = glossaryContent.replace(re, () => {
        const id = '9176' + String(gCnt++).padStart(4, '0');
        glossaryPh[id] = glossaryMap[term];
        return id;
      });
    }
  }

  const lines = glossaryContent.split('\n');
  let linesFixed = 0;

  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    const stripped = line.replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').replace(/`[^`]*`/g, '');
    if (!hasZh(stripped) || stripped.trim().length === 0) continue;

    const ph = {};
    let cnt = 0;
    let bare = line;
    const protectInline = (re) => {
      bare = bare.replace(re, m => { const id = '9175' + String(cnt++).padStart(4, '0'); ph[id] = m; return id; });
    };
    protectInline(/\{\{[^}]*\}\}/g);
    protectInline(/<[^>]+>/g);
    protectInline(/`[^`]*`/g);
    protectInline(/https?:\/\/[^\s]+/g);
    protectInline(/\$\$[\s\S]*?\$\$/g);
    protectInline(/\$[^$\n]+\$/g);
    protectInline(/^\|/gm);  // table leading pipe
    protectInline(/\|$/gm);  // table trailing pipe

    if (!hasZh(bare)) continue;

    try {
      if (logger) logger(`fallback line ${j + 1}/${lines.length}`);
      let result = await translateSmart(bare, translateFn);

      const sortedIds = Object.keys(ph).sort((a, b) => b.length - a.length);
      for (const id of sortedIds) result = result.split(id).join(ph[id]);
      for (const id of sortedIds) {
        const fuzzyRe = new RegExp(id.split('').map(ch => ch + '\\s*').join(''), 'g');
        result = result.replace(fuzzyRe, m => m.replace(/\s/g, '') === id ? ph[id] : m);
      }

      if (Object.keys(ph).some(id => result.includes(id))) continue;

      lines[j] = result;
      linesFixed++;
      await delay(1000);
    } catch(e) { /* keep original line */ }
  }

  if (linesFixed === 0) return { ok: false, reason: 'linewise: no lines translated', content };

  // Restore glossary placeholders
  let finalContent = lines.join('\n');
  const gSortedIds = Object.keys(glossaryPh).sort((a, b) => b.length - a.length);
  for (const id of gSortedIds) finalContent = finalContent.split(id).join(glossaryPh[id]);
  for (const id of gSortedIds) {
    const fuzzyRe = new RegExp(id.split('').map(ch => ch + '\\s*').join(''), 'g');
    finalContent = finalContent.replace(fuzzyRe, m => m.replace(/\s/g, '') === id ? glossaryPh[id] : m);
  }

  return { ok: true, content: finalContent, linesFixed };
}

// ── HTML-aware replaceString translation ─────────────────────

async function translateScriptStrings(scriptBlock, translateFn, glossaryMap) {
  // Extract content between <script...> and </script>
  const openMatch = scriptBlock.match(/^(<script[^>]*>)/i);
  const closeTag = '</script>';
  if (!openMatch) return scriptBlock;
  const openTag = openMatch[1];
  const inner = scriptBlock.slice(openTag.length, scriptBlock.length - closeTag.length);
  if (!hasZh(inner)) return scriptBlock;

  // Find all quoted strings containing Chinese
  const stringRe = /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  const replacements = [];
  let match;
  while ((match = stringRe.exec(inner)) !== null) {
    const full = match[0];
    const quote = full[0];
    const strContent = full.slice(1, -1);
    if (!hasZh(strContent)) continue;
    replacements.push({ start: match.index, end: match.index + full.length, quote, content: strContent });
  }

  if (replacements.length === 0) return scriptBlock;

  // Translate in reverse order to preserve indices
  let result = inner;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    try {
      const translated = await translateSmart(r.content, translateFn);
      if (translated !== r.content) {
        result = result.substring(0, r.start) + r.quote + translated + r.quote + result.substring(r.end);
      }
    } catch (e) { /* keep original on error */ }
  }

  return openTag + result + closeTag;
}

async function translateHtmlReplaceString(content, translateFn, chunkSize, logger, glossaryMap, concurrency) {
  let text = content;
  let backtickWrapper = null;

  // Strip triple-backtick wrapper
  const btMatch = text.match(/^(\s*```(?:html|htm)?\s*\n)([\s\S]*?)(\n\s*```\s*)$/i);
  if (btMatch) {
    backtickWrapper = { prefix: btMatch[1], suffix: btMatch[3] };
    text = btMatch[2];
  }

  // Segment into style/script/html zones
  const segmentRe = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const segments = [];
  let lastIdx = 0;
  let seg;
  while ((seg = segmentRe.exec(text)) !== null) {
    if (seg.index > lastIdx) segments.push({ type: 'html', content: text.slice(lastIdx, seg.index) });
    const tagType = seg[1].toLowerCase();
    segments.push({ type: tagType, content: seg[0] });
    lastIdx = seg.index + seg[0].length;
  }
  if (lastIdx < text.length) segments.push({ type: 'html', content: text.slice(lastIdx) });

  // Process each segment
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];

    if (s.type === 'style') continue; // CSS — skip

    if (s.type === 'script') {
      segments[i].content = await translateScriptStrings(s.content, translateFn, glossaryMap);
      continue;
    }

    // HTML zone — translate attributes first, then text content via translateContent
    if (s.type === 'html' && hasZh(s.content)) {
      let html = s.content;

      // Translate Chinese in key attributes
      const attrRe = /((?:placeholder|title|alt|aria-label|data-tip)\s*=\s*")((?:[^"\\]|\\.)*?)(")/gi;
      const attrMatches = [];
      let am;
      while ((am = attrRe.exec(html)) !== null) {
        if (hasZh(am[2])) attrMatches.push({ start: am.index + am[1].length, end: am.index + am[1].length + am[2].length, value: am[2] });
      }
      for (let j = attrMatches.length - 1; j >= 0; j--) {
        const a = attrMatches[j];
        try {
          const translated = await translateSmart(a.value, translateFn);
          if (translated !== a.value) html = html.substring(0, a.start) + translated + html.substring(a.end);
        } catch (e) { /* keep original */ }
      }

      // Translate text content between tags via existing translateContent
      const result = await translateContent(html, translateFn, chunkSize, logger, glossaryMap, concurrency);
      if (result.ok) segments[i].content = result.content;
    }
  }

  let translated = segments.map(s => s.content).join('');
  if (backtickWrapper) translated = backtickWrapper.prefix + translated + backtickWrapper.suffix;
  return translated;
}

// ── TUI ───────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const state = {
  engine: '', proxy: false, fromLang: '', toLang: '',
  inputFile: '', outputFile: '',
  total: 0, current: 0, currentName: '', currentDetail: '',
  translated: 0, skipped: 0, failed: 0, resumed: 0,
  startTime: 0, promptTimes: [],
  recentLog: [],
  spinnerIdx: 0,
  running: false,
};

function calcETA() {
  const times = state.promptTimes.slice(-10);
  if (times.length < 3) return t('dashCalculating');
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const processed = state.translated + state.skipped + state.failed;
  const remaining = state.total - processed;
  return '~' + fmtTime(avg * remaining / 1000);
}

function renderDashboard() {
  const spin = SPINNER_FRAMES[state.spinnerIdx % SPINNER_FRAMES.length];
  state.spinnerIdx++;

  const proxyStr = state.proxy ? chalk.green(t('dashProxyOn')) : chalk.red(t('dashProxyOff'));
  const glossaryCount = Object.keys(glossary).length;
  const glossaryStr = glossaryCount > 0 ? chalk.yellow(` ${glossaryCount} ${t('dashGlossaryTerms')}`) : chalk.gray(' ' + t('dashGlossaryNone'));
  const elapsed = fmtTime((Date.now() - state.startTime) / 1000);
  const eta = calcETA();
  const pct = state.total > 0 ? Math.floor(state.current / state.total * 100) : 0;

  const barWidth = 36;
  const filled = Math.floor(barWidth * pct / 100);
  const partial = (barWidth * pct / 100) - filled;
  const partialChar = partial > 0.5 ? '▓' : partial > 0 ? '▒' : '';
  const empty = barWidth - filled - (partialChar ? 1 : 0);
  const bar = chalk.cyan('█'.repeat(filled)) + chalk.cyan.dim(partialChar) + chalk.gray('░'.repeat(Math.max(0, empty)));

  const engineIcon = state.engine === 'bing' ? chalk.blue('⬡') : state.engine === 'google' ? chalk.red('◉') : chalk.magenta('◆');

  const header = boxen(
    chalk.bold.cyanBright('  ' + t('dashTitle')) + '\n' +
    chalk.gray('  ─────────────────────────────────────') + '\n' +
    `  ${chalk.gray(t('dashEngine'))}  ${engineIcon} ${chalk.white.bold(state.engine)}  ${chalk.gray('│')}  ${chalk.gray(t('dashProxy'))} ${proxyStr}` + '\n' +
    `  ${chalk.gray(t('dashLang'))}    ${chalk.white(state.fromLang)} ${chalk.cyan('→')} ${chalk.white.bold(state.toLang)}  ${chalk.gray('│')}  ${chalk.gray(t('dashGlossary'))}${glossaryStr}`,
    { padding: { top: 0, bottom: 0, left: 0, right: 1 }, borderColor: 'cyan', borderStyle: 'round' }
  );

  const resumeStr = state.resumed > 0 ? chalk.yellow(` (${t('dashResumed')} ${state.resumed})`) : '';
  const fileInfo = `  ${chalk.gray(t('dashFile'))} ${chalk.white(state.inputFile)} ${chalk.cyan('->')} ${chalk.green.bold(state.outputFile)}${resumeStr}`;

  const pctStr = String(pct).padStart(3);
  const progress = `  ${bar} ${chalk.bold.white(pctStr + '%')}  ${chalk.gray('(')}${state.current}${chalk.gray('/')}${state.total}${chalk.gray(')')}`;

  const currentLine = state.currentName
    ? `  ${chalk.cyan(spin)} ${chalk.white(state.currentName)}${state.currentDetail ? chalk.gray(' — ' + state.currentDetail) : ''}`
    : `  ${chalk.cyan(spin)} ${chalk.gray(t('dashWaiting'))}`;

  const timeLine = `  ${chalk.gray(t('dashElapsed'))} ${chalk.white(elapsed)}  ${chalk.gray('│')}  ${chalk.gray(t('dashEta'))} ${chalk.white(eta)}`;

  const recent = state.recentLog.slice(-5).map(l => '  ' + chalk.gray('│') + ' ' + l).join('\n');
  const recentBlock = recent ? `  ${chalk.gray(t('dashRecent'))}\n${recent}` : '';

  const stats = `  ${chalk.green.bold(state.translated)} ${chalk.green(t('dashTranslated'))}  ${chalk.gray('│')}  ${chalk.gray(state.skipped)} ${chalk.gray(t('dashSkipped'))}  ${chalk.gray('│')}  ${chalk.red.bold(state.failed)} ${chalk.red(t('dashFailed'))}`;
  const separator = chalk.gray('  ─────────────────────────────────────');

  const lines = [header, '', fileInfo, '', progress, currentLine, timeLine, '', separator, recentBlock, '', stats].filter(l => l !== undefined);
  logUpdate(lines.join('\n'));
}

function addRecentLog(icon, text) {
  const colored = icon === '✓' ? chalk.green(`✓ ${text}`)
    : icon === '⊘' ? chalk.gray(`⊘ ${text}`)
    : icon === '⚠' ? chalk.red(`⚠ ${text}`)
    : text;
  state.recentLog.push(colored);
  if (state.recentLog.length > 20) state.recentLog.shift();
}

// File logger
class FileLogger {
  constructor(enabled) {
    this.enabled = enabled;
    this.stream = null;
    if (enabled) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const logFile = `translate_${ts}.log`;
      this.stream = fs.createWriteStream(logFile, { flags: 'a' });
      this.log(`Log started: ${logFile}`);
    }
  }
  log(msg) {
    if (!this.enabled || !this.stream) return;
    this.stream.write(`[${new Date().toISOString()}] ${msg}\n`);
  }
  close() { if (this.stream) this.stream.end(); }
}

// ── Setup wizard ─────────────────────────────────────────────

function detectFileType(d) {
  if (d && Array.isArray(d.prompts)) return 'preset';
  if (d && d.data && (d.spec === 'chara_card_v3' || d.spec === 'chara_card_v2' || d.data.first_mes !== undefined)) return 'character_card';
  return null;
}

function getCharCardItemCount(d) {
  let count = 0;
  const fields = ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes'];
  for (const f of fields) if (d.data[f] && d.data[f].trim()) count++;
  count += (d.data.alternate_greetings || []).length;
  if (d.data.character_book && Array.isArray(d.data.character_book.entries))
    count += d.data.character_book.entries.length;
  return count;
}

function scanPresets(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('_lock.json') && f !== 'package.json' && f !== 'package-lock.json' && f !== 'scriptNames.json');
  return files.map(f => {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    let type = null, itemCount = '?';
    try {
      const d = JSON.parse(fs.readFileSync(full, 'utf8'));
      type = detectFileType(d);
      if (type === 'preset') itemCount = d.prompts.length;
      else if (type === 'character_card') itemCount = getCharCardItemCount(d);
    } catch (e) {}
    return { name: f, size: stat.size, type, items: itemCount, path: full };
  }).filter(f => f.type !== null);
}

async function interactiveSetup() {
  const dir = process.cwd();
  const gCount = Object.keys(glossary).length;

  const step = (n, total, label) => {
    const dots = chalk.gray('·'.repeat(n)) + chalk.gray.dim('·'.repeat(total - n));
    console.log(chalk.cyan(`  [${ n }/${ total }]`) + ' ' + dots + ' ' + chalk.bold(label));
  };

  // ── Step 1: File ──
  step(1, 6, t('step1'));
  const presets = scanPresets(dir);
  if (presets.length === 0) {
    console.log(chalk.red('\n  ' + t('noFiles')));
    process.exit(1);
  }

  const { file } = await inquirer.prompt([{
    type: 'list', name: 'file',
    message: t('msgPreset'),
    prefix: '  ',
    choices: presets.map(p => {
      const sizeStr = (p.size / 1024).toFixed(0).padStart(4);
      const typeLabel = p.type === 'character_card' ? chalk.magenta('Character Card') : chalk.blue('Preset');
      const itemLabel = p.type === 'character_card' ? t('fieldsLabel') : t('promptsLabel');
      return {
        name: `  ${chalk.white.bold(p.name)}  ${chalk.gray('(')}${typeLabel}${chalk.gray(')')}  ${chalk.gray('│')}  ${chalk.yellow(sizeStr + ' KB')}  ${chalk.gray('│')}  ${chalk.cyan(p.items + ' ' + itemLabel)}`,
        value: p.name, short: p.name,
      };
    }),
  }]);
  console.log();

  // ── Step 2: Engine ──
  step(2, 6, t('step2'));
  const engineChoices = [
    { name: `  ${chalk.blue('⬡')} ${chalk.white.bold('Bing Translate')}      ${chalk.gray(t('engBingDesc'))}`, value: 'bing', short: 'Bing' },
    { name: `  ${chalk.red('◉')} ${chalk.white.bold('Google Translate')}    ${chalk.gray(t('engGoogleDesc'))}`, value: 'google', short: 'Google' },
    { name: `  ${chalk.magenta('◆')} ${chalk.white.bold('LLM (OpenAI-compat)')}  ${chalk.gray(t('engLlmDesc'))}`, value: 'llm', short: 'LLM' },
  ];
  if (savedConfig.engine) {
    const idx = engineChoices.findIndex(c => c.value === savedConfig.engine);
    if (idx > 0) { const [item] = engineChoices.splice(idx, 1); engineChoices.unshift(item); }
  }
  const { engine } = await inquirer.prompt([{
    type: 'list', name: 'engine',
    message: t('msgPrimary'),
    prefix: '  ',
    choices: engineChoices,
  }]);

  // Fallback
  const fbEngines = ['bing', 'google', 'llm'].filter(e => e !== engine);
  const fallbackChoices = [
    { name: `  ${chalk.gray('○')} ${chalk.gray(t('fallbackNone'))}`, value: 'none', short: t('fallbackNone') },
    ...fbEngines.map(e => ({
      name: `  ${e === 'bing' ? chalk.blue('⬡') : e === 'google' ? chalk.red('◉') : chalk.magenta('◆')} ${chalk.white(e === 'bing' ? 'Bing' : e === 'google' ? 'Google' : 'LLM')}`,
      value: e, short: e,
    })),
  ];
  const { fallbackEngine } = await inquirer.prompt([{
    type: 'list', name: 'fallbackEngine',
    message: t('msgFallback'),
    prefix: '  ',
    choices: fallbackChoices,
  }]);
  console.log();

  let llmConfig = null;
  if (engine === 'llm' || fallbackEngine === 'llm') {
    console.log(chalk.cyan('  ' + t('llmConfigTitle')));
    const savedLlm = savedConfig.llm || {};
    const llmAnswers = await inquirer.prompt([
      { type: 'input', name: 'url', message: t('llmUrl'), prefix: '  ', default: ARG_LLM_URL || savedLlm.url || 'http://127.0.0.1:5001' },
      { type: 'input', name: 'key', message: t('llmKey'), prefix: '  ', default: ARG_LLM_KEY || savedLlm.key || 'sk-no-key' },
      { type: 'input', name: 'model', message: t('llmModel'), prefix: '  ', default: ARG_LLM_MODEL || savedLlm.model || 'gpt-4o-mini' },
    ]);
    llmConfig = llmAnswers;
    console.log();
  }

  // ── Step 3: Source language ──
  step(3, 6, t('step3'));
  const srcChoices = [
    { name: `  🇨🇳  ${chalk.white.bold('Chinese (Simplified)')}`, value: 'zh-Hans', short: 'zh-Hans' },
    { name: `  🇹🇼  ${chalk.white.bold('Chinese (Traditional)')}`, value: 'zh-Hant', short: 'zh-Hant' },
    { name: `  🇯🇵  ${chalk.white.bold('Japanese')}`, value: 'ja', short: 'ja' },
    { name: `  🇰🇷  ${chalk.white.bold('Korean')}`, value: 'ko', short: 'ko' },
    { name: `  🇬🇧  ${chalk.white.bold('English')}`, value: 'en', short: 'en' },
    { name: `  ${chalk.gray('...')}  ${chalk.gray(t('langOther'))}`, value: '_other', short: t('langOther') },
  ];
  if (savedConfig.fromLang) {
    const idx = srcChoices.findIndex(c => c.value === savedConfig.fromLang);
    if (idx > 0) { const [item] = srcChoices.splice(idx, 1); srcChoices.unshift(item); }
  }
  const { fromLang } = await inquirer.prompt([{
    type: 'list', name: 'fromLang',
    message: t('msgFrom'),
    prefix: '  ',
    choices: srcChoices,
  }]);
  let sourceLang = fromLang;
  if (fromLang === '_other') {
    const { custom } = await inquirer.prompt([{ type: 'input', name: 'custom', message: t('msgLangCode'), prefix: '  ' }]);
    sourceLang = custom;
  }
  console.log();

  // ── Step 4: Target language ──
  step(4, 6, t('step4'));
  const tgtChoices = [
    { name: `  🇬🇧  ${chalk.white.bold('English')}`, value: 'en', short: 'en' },
    { name: `  🇷🇺  ${chalk.white.bold('Russian')}`, value: 'ru', short: 'ru' },
    { name: `  🇯🇵  ${chalk.white.bold('Japanese')}`, value: 'ja', short: 'ja' },
    { name: `  🇰🇷  ${chalk.white.bold('Korean')}`, value: 'ko', short: 'ko' },
    { name: `  🇩🇪  ${chalk.white.bold('German')}`, value: 'de', short: 'de' },
    { name: `  🇫🇷  ${chalk.white.bold('French')}`, value: 'fr', short: 'fr' },
    { name: `  🇪🇸  ${chalk.white.bold('Spanish')}`, value: 'es', short: 'es' },
    { name: `  ${chalk.gray('...')}  ${chalk.gray(t('langOther'))}`, value: '_other', short: t('langOther') },
  ];
  if (savedConfig.toLang) {
    const idx = tgtChoices.findIndex(c => c.value === savedConfig.toLang);
    if (idx > 0) { const [item] = tgtChoices.splice(idx, 1); tgtChoices.unshift(item); }
  }
  const { toLang } = await inquirer.prompt([{
    type: 'list', name: 'toLang',
    message: t('msgTo'),
    prefix: '  ',
    choices: tgtChoices,
  }]);
  let targetLang = toLang;
  if (toLang === '_other') {
    const { custom } = await inquirer.prompt([{ type: 'input', name: 'custom', message: t('msgLangCode'), prefix: '  ' }]);
    targetLang = custom;
  }
  console.log();

  // ── Step 5: Options ──
  step(5, 6, t('step5'));
  const optionChoices = [
    { name: `  ${chalk.yellow('⚡')} ${t('optDryRun')} ${chalk.gray(t('optDryRunHint'))}`, value: 'dryRun' },
    { name: `  ${chalk.green('📝')} ${t('optLog')}`, value: 'log' },
    { name: `  ${chalk.cyan('📖')} ${t('optGlossary')} ${chalk.gray(`(${gCount} ${t('summaryTerms')})`)}`, value: 'glossary' },
  ];
  const { options } = await inquirer.prompt([{
    type: 'checkbox', name: 'options',
    message: t('msgOptionsToggle'),
    prefix: '  ',
    choices: optionChoices,
  }]);

  // Glossary editor
  if (options.includes('glossary')) {
    console.log();
    console.log(boxen(
      chalk.bold.cyan(t('glossEditorTitle')) + '\n' +
      chalk.gray(t('glossEditorDesc')),
      { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderColor: 'cyan', borderStyle: 'round' }
    ));
    if (Object.keys(glossary).length > 0) {
      console.log();
      Object.entries(glossary).forEach(([k, v]) => console.log(`    ${chalk.yellow(k)}  ${chalk.gray('→')}  ${chalk.green(v)}`));
    }
    let editing = true;
    while (editing) {
      console.log();
      const { action } = await inquirer.prompt([{
        type: 'list', name: 'action', message: t('glossAction'),
        prefix: '  ',
        choices: [
          { name: `  ${chalk.green('+')} ${t('glossAdd')}`, value: 'add' },
          { name: `  ${chalk.red('−')} ${t('glossRemove')}`, value: 'remove' },
          { name: `  ${chalk.gray('✓')} ${t('glossDone')}`, value: 'done' },
        ],
      }]);
      if (action === 'add') {
        const { src, tgt } = await inquirer.prompt([
          { type: 'input', name: 'src', message: t('glossSrcTerm'), prefix: '    ' },
          { type: 'input', name: 'tgt', message: t('glossTranslation'), prefix: '    ' },
        ]);
        if (src && tgt) { glossary[src] = tgt; console.log(`    ${chalk.green('+')} ${chalk.yellow(src)}  →  ${chalk.green(tgt)}`); }
      } else if (action === 'remove') {
        const keys = Object.keys(glossary);
        if (keys.length === 0) { console.log(chalk.gray('    ' + t('glossEmpty'))); continue; }
        const { term } = await inquirer.prompt([{
          type: 'list', name: 'term', message: t('glossRemove') + ':', prefix: '    ',
          choices: keys.map(k => ({ name: `${chalk.yellow(k)}  →  ${chalk.green(glossary[k])}`, value: k })),
        }]);
        delete glossary[term];
        console.log(`    ${chalk.red('−')} ${term}`);
      } else { editing = false; }
    }
    saveGlossary(glossary);
    console.log(chalk.green(`\n  ${t('glossSaved')} (${Object.keys(glossary).length} ${t('summaryTerms')})`));
  }
  console.log();

  const selectedPreset = presets.find(p => p.name === file);
  const fileType = selectedPreset ? selectedPreset.type : 'preset';

  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const outputFile = `${base}_${targetLang}${ext}`;

  // ── Step 6: Confirm ──
  step(6, 6, t('step6'));
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

  let needsTranslation, totalItems;
  if (fileType === 'character_card') {
    const items = getCharCardItems(data);
    totalItems = items.length;
    needsTranslation = items.filter(it => hasZh(it.content)).length;
  } else {
    totalItems = data.prompts.length;
    needsTranslation = data.prompts.filter(p => (p.name && hasZh(p.name)) || (p.content && hasZh(p.content))).length;
  }

  const glossaryInfo = Object.keys(glossary).length > 0 ? `\n${chalk.cyan('📖')} ${t('summaryGlossary')}: ${chalk.white(Object.keys(glossary).length)} ${t('summaryTerms')}` : '';
  const fallbackInfo = fallbackEngine !== 'none' ? `  ${chalk.gray('→')}  ${chalk.white(fallbackEngine)}` : '';
  const engineIcon = engine === 'bing' ? chalk.blue('⬡') : engine === 'google' ? chalk.red('◉') : chalk.magenta('◆');
  const itemsLabel = fileType === 'character_card' ? t('summaryFields') : t('summaryPrompts');

  const totalSize = (fs.statSync(path.join(dir, file)).size / 1024).toFixed(0);
  console.log(boxen(
    `  ${chalk.gray(t('summaryFile'))}      ${chalk.cyan.bold(file)} ${chalk.cyan('->')} ${chalk.green.bold(outputFile)} ${chalk.gray('(' + totalSize + ' KB)')}\n` +
    `  ${chalk.gray(t('summaryEngine'))}    ${engineIcon} ${chalk.white.bold(engine)}${fallbackInfo}\n` +
    `  ${chalk.gray(t('summaryLang'))}  ${chalk.white.bold(sourceLang)} ${chalk.cyan('->')} ${chalk.white.bold(targetLang)}\n` +
    `  ${chalk.gray(itemsLabel)}   ${chalk.white.bold(totalItems)} ${t('summaryTotal')}  ${chalk.gray('·')}  ${chalk.yellow.bold(needsTranslation)} ${t('summaryToTranslate')}${glossaryInfo}`,
    { padding: { top: 0, bottom: 0, left: 1, right: 2 }, borderColor: 'green', borderStyle: 'round', title: chalk.bold.green(t('summaryTitle')), titleAlignment: 'center' }
  ));

  const { confirm } = await inquirer.prompt([{
    type: 'confirm', name: 'confirm', message: chalk.bold(t('msgStartQuestion')), prefix: '  ', default: true
  }]);
  if (!confirm) { console.log(chalk.gray('\n  ' + t('msgCancelled'))); process.exit(0); }
  console.log();

  return {
    inputFile: file, outputFile, engine, fallbackEngine, llmConfig, fileType,
    fromLang: sourceLang, toLang: targetLang,
    dryRun: options.includes('dryRun') || FLAG_DRY_RUN,
    log: options.includes('log') || FLAG_LOG,
  };
}

// ── Main ──────────────────────────────────────────────────────

function dryRun(data, config) {
  console.log();

  let needName = 0, needContent = 0, ok = 0;
  const rows = [];
  data.prompts.forEach((p, i) => {
    const nn = p.name && hasZh(p.name);
    const nc = p.content && hasZh(p.content);
    if (nn) needName++;
    if (nc) needContent++;
    if (!nn && !nc) { ok++; return; }

    const nameTag = nn ? chalk.bgYellow.black(' NAME ') : chalk.green(' ok ');
    const sizeStr = nc ? chalk.yellow((p.content.length / 1024).toFixed(1) + ' KB') : chalk.green('ok');
    const label = (p.name || '(marker)').substring(0, 40);
    rows.push(`  ${chalk.gray('#' + String(i).padStart(3))}  ${nameTag}  ${sizeStr.padEnd(18)}  ${chalk.white(label)}`);
  });

  const total = data.prompts.length;
  const pctOk = total > 0 ? Math.round(ok / total * 100) : 0;

  console.log(boxen(
    chalk.bold.yellow(t('dryTitle')) + '\n' +
    chalk.gray('  ─────────────────────────────────') + '\n\n' +
    rows.join('\n') + '\n\n' +
    chalk.gray('  ─────────────────────────────────') + '\n' +
    `  ${chalk.green.bold(ok)} ${chalk.green(t('dryReady'))} ${chalk.gray('(' + pctOk + '%)')}  ${chalk.gray('│')}  ${chalk.yellow.bold(needName)} ${chalk.yellow(t('dryNames'))}  ${chalk.gray('│')}  ${chalk.yellow.bold(needContent)} ${chalk.yellow(t('dryContents'))}`,
    { padding: { top: 0, bottom: 0, left: 1, right: 2 }, borderColor: 'yellow', borderStyle: 'round', title: chalk.bold.yellow(t('dryScanTitle')), titleAlignment: 'center' }
  ));
  console.log();
}

// ── Character card helpers ────────────────────────────────────

const CC_TEXT_FIELDS = ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions','creator_notes'];

function getCharCardItems(root) {
  const d = root.data || root;
  const items = [];
  for (const f of CC_TEXT_FIELDS) {
    if (d[f] && d[f].trim()) items.push({ id: `field:${f}`, label: f, content: d[f], type: 'field' });
  }
  (d.alternate_greetings || []).forEach((g, i) => {
    if (g && g.trim()) items.push({ id: `greeting:${i}`, label: `${t('ccAltGreeting')} #${i+1}`, content: g, type: 'greeting', index: i });
  });
  if (d.character_book && Array.isArray(d.character_book.entries)) {
    d.character_book.entries.forEach((e, i) => {
      if (e.content && e.content.trim()) items.push({ id: `lore:${i}`, label: `${t('ccLorebookEntry')} #${i+1} ${(e.comment||'').substring(0,20)}`, content: e.content, type: 'lore', index: i });
    });
  }
  return items;
}

function writeCharCardItem(root, item, translatedContent) {
  const d = root.data || root;
  if (item.type === 'field') {
    const f = item.id.replace('field:', '');
    d[f] = translatedContent;
    if (root[f] !== undefined) root[f] = translatedContent;
  } else if (item.type === 'greeting') {
    d.alternate_greetings[item.index] = translatedContent;
  } else if (item.type === 'lore') {
    d.character_book.entries[item.index].content = translatedContent;
  }
}

function dryRunCharCard(data) {
  console.log();
  const items = getCharCardItems(data);
  let needTranslation = 0, ok = 0;
  const rows = [];
  items.forEach((it, i) => {
    const nc = hasZh(it.content);
    if (nc) needTranslation++; else { ok++; return; }
    const sizeStr = chalk.yellow((it.content.length / 1024).toFixed(1) + ' KB');
    rows.push(`  ${chalk.gray('#' + String(i).padStart(3))}  ${sizeStr.padEnd(18)}  ${chalk.white(it.label.substring(0, 50))}`);
  });
  const total = items.length;
  const pctOk = total > 0 ? Math.round(ok / total * 100) : 0;
  const regexCount = getRegexScriptArrays(data).flat().length;
  const regexLine = regexCount > 0 ? `  ${chalk.gray('│')}  ${chalk.cyan.bold(regexCount)} ${chalk.cyan(t('regexScripts'))}` : '';
  console.log(boxen(
    chalk.bold.yellow(t('dryTitle')) + '\n' +
    chalk.gray('  ─────────────────────────────────') + '\n\n' +
    rows.join('\n') + '\n\n' +
    chalk.gray('  ─────────────────────────────────') + '\n' +
    `  ${chalk.green.bold(ok)} ${chalk.green(t('dryReady'))} ${chalk.gray('(' + pctOk + '%)')}  ${chalk.gray('│')}  ${chalk.yellow.bold(needTranslation)} ${chalk.yellow(t('dryContents'))}${regexLine}`,
    { padding: { top: 0, bottom: 0, left: 1, right: 2 }, borderColor: 'yellow', borderStyle: 'round', title: chalk.bold.yellow(t('dryScanTitle')), titleAlignment: 'center' }
  ));
  console.log();
}

// ── Regex script translation ──────────────────────────────────

// collect all regex_scripts arrays (handles extensions nesting + SPreset binding)
function getRegexScriptArrays(data) {
  const arrays = [];
  if (data.extensions && Array.isArray(data.extensions.regex_scripts))
    arrays.push(data.extensions.regex_scripts);
  if (data.extensions && data.extensions.SPreset &&
      data.extensions.SPreset.RegexBinding &&
      Array.isArray(data.extensions.SPreset.RegexBinding.regexes))
    arrays.push(data.extensions.SPreset.RegexBinding.regexes);
  if (Array.isArray(data.regex_scripts))          // top-level fallback
    arrays.push(data.regex_scripts);
  return arrays;
}

function buildRegexMarkerPool(data) {
  const allScripts = getRegexScriptArrays(data).flat();
  const pool = new Set();
  for (const s of allScripts) {
    if (!s.findRegex) continue;
    const raw = String(s.findRegex).replace(/^\//, '').replace(/\/[gimsuy]*$/, '');
    const found = raw.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g);
    if (found) found.forEach(m => pool.add(m));
  }
  return pool;
}

function mergeMarkerPool(baseGlossary, markerPool) {
  if (markerPool.size === 0) return baseGlossary;
  const merged = { ...baseGlossary };
  for (const term of markerPool) {
    if (!(term in merged)) merged[term] = term;
  }
  return merged;
}

async function translateRegexScripts(data, translateFn, fallbackFn, chunkSize, fallbackChunkSize, glossary, concurrency, outputPath, logger) {
  const scriptArrays = getRegexScriptArrays(data);
  const allScripts = scriptArrays.flat();
  if (allScripts.length === 0) return { translated: 0, skipped: 0, failed: 0 };

  const markerPool = buildRegexMarkerPool(data);
  const safeGlossary = mergeMarkerPool(glossary, markerPool);

  let translated = 0, skipped = 0, failed = 0;

  console.log(chalk.bold.cyan(`\n  ${t('regexPhase')}`));
  console.log();

  for (const scripts of scriptArrays) for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    let changed = false;
    const label = (s.scriptName || `#${i}`).substring(0, 50);

    if (s.scriptName && hasZh(s.scriptName)) {
      try {
        const newName = await translateSmart(s.scriptName, translateFn);
        if (newName !== s.scriptName) { s.scriptName = newName; changed = true; }
        logger.log(`[regex:${i}] Name: ${s.scriptName}`);
        await delay(400);
      } catch (e) {
        logger.log(`[regex:${i}] Name FAILED: ${e.message}`);
      }
    }

    // replaceString — HTML-aware or cascade with safe glossary; findRegex never touched
    if (s.replaceString && hasZh(s.replaceString)) {
      const looksLikeHtml = /^\s*```(?:html|htm)?\s*\n/i.test(s.replaceString) ||
        (/<[a-z][\s\S]*>/i.test(s.replaceString) && /<\/(?:div|span|style|script|p|body|html|section|header|footer)\b/i.test(s.replaceString));

      if (looksLikeHtml) {
        try {
          const translated = await translateHtmlReplaceString(s.replaceString, translateFn, chunkSize, (msg) => logger.log(`[regex:${i}] HTML: ${msg}`), safeGlossary, concurrency);
          if (translated !== s.replaceString) {
            s.replaceString = translated;
            changed = true;
            logger.log(`[regex:${i}] replaceString OK (HTML mode)`);
          }
        } catch (e) {
          failed++;
          logger.log(`[regex:${i}] HTML mode ERROR: ${e.message}`);
        }
      } else {
        try {
          const cascade = [
            { fn: translateFn, cs: chunkSize, mode: 'chunk' },
            { fn: translateFn, cs: chunkSize, mode: 'linewise' },
          ];
          if (fallbackFn) {
            cascade.push({ fn: fallbackFn, cs: fallbackChunkSize, mode: 'chunk' });
            cascade.push({ fn: fallbackFn, cs: fallbackChunkSize, mode: 'linewise' });
          }

          let result = null;
          for (const attempt of cascade) {
            const r = attempt.mode === 'chunk'
              ? await translateContent(s.replaceString, attempt.fn, attempt.cs, () => {}, safeGlossary, concurrency)
              : await translateContentLinewise(s.replaceString, attempt.fn, () => {}, concurrency, safeGlossary);
            if (r.ok) { result = r; break; }
          }

          if (result && result.ok && result.content !== s.replaceString) {
            s.replaceString = result.content;
            changed = true;
            logger.log(`[regex:${i}] replaceString OK`);
          } else if (!result || !result.ok) {
            failed++;
            logger.log(`[regex:${i}] replaceString FAIL`);
          }
        } catch (e) {
          failed++;
          logger.log(`[regex:${i}] replaceString ERROR: ${e.message}`);
        }
      }
    }

    if (changed) {
      translated++;
      console.log(`  ${chalk.green('✓')} ${chalk.white(label)}`);
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 4));
    } else {
      skipped++;
      console.log(`  ${chalk.gray('⊘')} ${chalk.gray(label)}`);
    }
  }

  console.log();
  return { translated, skipped, failed };
}

async function main() {
  drawLogo();
  await selectInterfaceLang();
  const config = await interactiveSetup();
  const dir = process.cwd();
  const inputPath = path.join(dir, config.inputFile);
  const outputPath = path.join(dir, config.outputFile);
  const logger = new FileLogger(config.log);

  const isCharCard = config.fileType === 'character_card';

  let data;
  let resumeCount = 0;
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      if (isCharCard) {
        const origItems = getCharCardItems(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
        const existItems = getCharCardItems(existing);
        let done = 0;
        for (let i = 0; i < origItems.length && i < existItems.length; i++) {
          if (origItems[i].content !== existItems[i].content) done++;
        }
        if (done > 0) { data = existing; resumeCount = done; logger.log(`Resuming from ${config.outputFile} (${resumeCount} already done)`); }
      } else {
        const translatedNames = existing.prompts.filter(p => p.name && !hasZh(p.name)).length;
        if (translatedNames > 10) {
          data = existing;
          resumeCount = translatedNames;
          logger.log(`Resuming from ${config.outputFile} (${resumeCount} already done)`);
        }
      }
    } catch (e) {}
  }
  if (!data) {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  }

  // Dry run?
  if (config.dryRun) {
    if (isCharCard) dryRunCharCard(data);
    else dryRun(data, config);
    logger.close();
    return;
  }

  // Collect known variable names (presets only)
  const knownVarNames = new Set();
  if (!isCharCard) {
    data.prompts.forEach(p => {
      if (!p.content) return;
      const re = /\{\{(?:set(?:global)?var|get(?:global)?var|addvar|incvar|decvar)::([^:}]+)/g;
      let m;
      while ((m = re.exec(p.content)) !== null) knownVarNames.add(m[1]);
    });
  }

  const translateFn = createTranslator(config.engine, config.fromLang, config.toLang, config.llmConfig);
  const fallbackFn = config.fallbackEngine !== 'none'
    ? createTranslator(config.fallbackEngine, config.fromLang, config.toLang, config.llmConfig)
    : null;
  const chunkSize = config.engine === 'llm' ? 4000 : 1500;
  const fallbackChunkSize = config.fallbackEngine === 'llm' ? 4000 : 1500;
  const concurrency = CONCURRENCY[config.engine] || 3;

  state.engine = config.engine;
  state.proxy = !!proxyAgents;
  state.fromLang = config.fromLang;
  state.toLang = config.toLang;
  state.inputFile = config.inputFile;
  state.outputFile = config.outputFile;
  state.total = isCharCard ? getCharCardItems(data).length : data.prompts.length;
  state.resumed = resumeCount;
  state.startTime = Date.now();
  state.running = true;

  const renderInterval = setInterval(() => { if (state.running) renderDashboard(); }, 200);

  process.on('SIGINT', () => {
    state.running = false;
    clearInterval(renderInterval);
    logUpdate.clear();
    // Save current progress
    try { fs.writeFileSync(outputPath, JSON.stringify(data, null, 4)); } catch (e) {}
    const elapsed = fmtTime((Date.now() - state.startTime) / 1000);
    console.log('\n' + boxen(
      chalk.bold.yellow('  ' + t('interrupted')) + '\n' +
      chalk.gray('  ─────────────────────────────────') + '\n' +
      `  ${chalk.gray(t('sigintFile'))}    ${chalk.green(config.outputFile)}\n` +
      `  ${chalk.gray(t('sigintTime'))}    ${chalk.white(elapsed)}\n` +
      `  ${chalk.green.bold(state.translated)} ${chalk.green(t('dashTranslated'))}  ${chalk.gray('│')}  ${chalk.gray(state.skipped)} ${chalk.gray(t('dashSkipped'))}  ${chalk.gray('│')}  ${chalk.red.bold(state.failed)} ${chalk.red(t('dashFailed'))}`,
      { padding: { top: 0, bottom: 0, left: 1, right: 2 }, borderColor: 'yellow', borderStyle: 'round' }
    ));
    logger.close();
    process.exit(0);
  });

  // ── Shared cascade helper ──
  async function cascadeTranslate(content, idx, label, loggerRef, overrideGlossary) {
    const attempts = [
      { fn: translateFn, cs: chunkSize, mode: 'chunk', label: config.engine },
      { fn: translateFn, cs: chunkSize, mode: 'linewise', label: `${config.engine} linewise` },
    ];
    if (fallbackFn) {
      attempts.push({ fn: fallbackFn, cs: fallbackChunkSize, mode: 'chunk', label: config.fallbackEngine });
      attempts.push({ fn: fallbackFn, cs: fallbackChunkSize, mode: 'linewise', label: `${config.fallbackEngine} linewise` });
    }
    for (const attempt of attempts) {
      const logDetail = (detail) => { state.currentDetail = detail; loggerRef.log(`[${idx}] ${detail}`); };
      let result;
      if (attempt.mode === 'chunk') {
        result = await translateContent(content, attempt.fn, attempt.cs, logDetail, overrideGlossary || glossary, concurrency);
      } else {
        state.currentDetail = `fallback: ${attempt.label}...`;
        result = await translateContentLinewise(content, attempt.fn, logDetail, concurrency, overrideGlossary || glossary);
      }
      if (result.ok) {
        if (attempt !== attempts[0]) addRecentLog('⚠', `#${idx} ${label} — via ${attempt.label}`);
        return result;
      }
      loggerRef.log(`[${idx}] ${attempt.label} failed (${result.reason}), trying next...`);
    }
    return null;
  }

  if (isCharCard) {
    // ── Character card translation loop ──
    const markerPool = buildRegexMarkerPool(data.data || data);
    const cardGlossary = mergeMarkerPool(glossary, markerPool);
    if (markerPool.size > 0) logger.log(`Regex marker pool: ${markerPool.size} terms protected`);

    const items = getCharCardItems(data);
    state.total = items.length;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      state.current = i + 1;

      if (!hasZh(item.content)) {
        state.skipped++;
        addRecentLog('⊘', `#${i} ${item.label.substring(0, 40)} — skipped`);
        logger.log(`[${i}] SKIP: ${item.label}`);
        continue;
      }

      const itemStart = Date.now();
      state.currentName = item.label.substring(0, 40);
      state.currentDetail = `translating (${(item.content.length / 1024).toFixed(1)} KB)...`;
      logger.log(`[${i}] ${item.label}: ${item.content.length} chars`);

      try {
        const result = await cascadeTranslate(item.content, i, item.label, logger, cardGlossary);
        if (result && result.ok) {
          writeCharCardItem(data, item, result.content);
          state.translated++;
          addRecentLog('✓', `#${i} ${item.label}`);
          logger.log(`[${i}] OK`);
          fs.writeFileSync(outputPath, JSON.stringify(data, null, 4));
        } else {
          state.failed++;
          addRecentLog('⚠', `#${i} ${item.label} — all engines failed`);
          logger.log(`[${i}] FAIL: all cascade attempts exhausted`);
        }
      } catch (e) {
        state.failed++;
        addRecentLog('⚠', `#${i} ${item.label} — ERROR: ${e.message}`);
        logger.log(`[${i}] ERROR: ${e.message}`);
      }

      state.promptTimes.push(Date.now() - itemStart);
    }
  } else {
    // ── Preset translation loop ──
    for (let i = 0; i < data.prompts.length; i++) {
      const p = data.prompts[i];
      state.current = i + 1;
      let changed = false;

      const nameNeedsTranslation = p.name && hasZh(p.name);
      const contentNeedsTranslation = p.content && hasZh(p.content);

      if (!nameNeedsTranslation && !contentNeedsTranslation) {
        state.skipped++;
        addRecentLog('⊘', `#${i} ${(p.name || '(marker)').substring(0, 40)} — skipped`);
        logger.log(`[${i}] SKIP: ${p.name}`);
        continue;
      }

      const promptStart = Date.now();
      state.currentName = (p.name || '(marker)').substring(0, 40);
      state.currentDetail = '';

      if (nameNeedsTranslation) {
        state.currentDetail = 'translating name...';
        try {
          const translated = await translateSmart(p.name, translateFn);
          p.name = translated;
          changed = true;
          state.currentName = p.name.substring(0, 40);
          logger.log(`[${i}] Name: ${p.name}`);
          await delay(800);
        } catch (e) {
          logger.log(`[${i}] Name FAILED: ${e.message}`);
        }
      }

      if (contentNeedsTranslation) {
        state.currentDetail = `translating content (${(p.content.length / 1024).toFixed(1)} KB)...`;
        logger.log(`[${i}] Content: ${p.content.length} chars`);

        try {
          const contentResult = await cascadeTranslate(p.content, i, state.currentName, logger);
          if (contentResult && contentResult.ok) {
            p.content = contentResult.content;
            changed = true;
            state.translated++;
            addRecentLog('✓', `#${i} ${state.currentName}`);
            logger.log(`[${i}] OK`);
          } else {
            state.failed++;
            addRecentLog('⚠', `#${i} ${state.currentName} — all engines failed`);
            logger.log(`[${i}] FAIL: all cascade attempts exhausted`);
          }
        } catch (e) {
          state.failed++;
          addRecentLog('⚠', `#${i} ${state.currentName} — ERROR: ${e.message}`);
          logger.log(`[${i}] ERROR: ${e.message}`);
        }
      } else if (changed) {
        state.translated++;
        addRecentLog('✓', `#${i} ${state.currentName} (name only)`);
      }

      state.promptTimes.push(Date.now() - promptStart);

      if (changed) {
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 4));
      }
    }
  }

  // Done — stop dashboard
  state.running = false;
  clearInterval(renderInterval);
  logUpdate.clear();

  let regexStats = { translated: 0, skipped: 0, failed: 0 };
  if (getRegexScriptArrays(data).some(a => a.length > 0)) {
    regexStats = await translateRegexScripts(
      data, translateFn, fallbackFn, chunkSize, fallbackChunkSize,
      glossary, concurrency, outputPath, logger
    );
  }

  const elapsed = fmtTime((Date.now() - state.startTime) / 1000);
  const outSize = fs.existsSync(outputPath) ? (fs.statSync(outputPath).size / 1024).toFixed(0) : '?';

  const successRate = state.total > 0 ? Math.round((state.translated / (state.translated + state.failed)) * 100) || 0 : 0;
  const barLen = 20;
  const successFill = Math.round(barLen * successRate / 100);
  const successBar = chalk.green('█'.repeat(successFill)) + chalk.gray('░'.repeat(barLen - successFill));

  const regexLine = (regexStats.translated + regexStats.skipped + regexStats.failed > 0)
    ? `\n  ${chalk.gray(t('regexScripts'))}  ${chalk.green.bold(String(regexStats.translated).padStart(3))} ${chalk.green(t('doneTranslated'))}  ${chalk.gray('│')}  ${chalk.gray(String(regexStats.skipped).padStart(3))} ${chalk.gray(t('doneSkipped'))}  ${chalk.gray('│')}  ${chalk.red.bold(String(regexStats.failed).padStart(3))} ${chalk.red(t('doneFailed'))}`
    : '';

  console.log(boxen(
    chalk.bold.greenBright('  ' + t('doneBanner')) + '\n' +
    chalk.gray('  ─────────────────────────────────') + '\n\n' +
    `  ${chalk.gray(t('doneFile'))}       ${chalk.white(config.inputFile)} ${chalk.cyan('->')} ${chalk.green.bold(config.outputFile)}\n` +
    `  ${chalk.gray(t('doneSize'))}       ${chalk.white(outSize + ' KB')}\n` +
    `  ${chalk.gray(t('doneTime'))}       ${chalk.white(elapsed)}\n\n` +
    `  ${chalk.gray(t('doneResults'))}    ${successBar} ${chalk.bold(successRate + t('doneSuccess'))}\n` +
    `  ${chalk.green.bold(String(state.translated).padStart(4))} ${chalk.green(t('doneTranslated'))}  ${chalk.gray('│')}  ${chalk.gray(String(state.skipped).padStart(4))} ${chalk.gray(t('doneSkipped'))}  ${chalk.gray('│')}  ${chalk.red.bold(String(state.failed).padStart(4))} ${chalk.red(t('doneFailed'))}` +
    regexLine,
    { padding: { top: 1, bottom: 1, left: 1, right: 2 }, borderColor: 'green', borderStyle: 'round', title: chalk.bold.green(t('doneTitle')), titleAlignment: 'center' }
  ));

  logger.log(`Done: ${state.translated} translated, ${state.skipped} skipped, ${state.failed} failed`);
  logger.close();

  const { saveSettings } = await inquirer.prompt([{
    type: 'confirm', name: 'saveSettings', message: t('saveSettings'), default: true
  }]);
  if (saveSettings) {
    saveConfig({
      lang: currentLang,
      engine: config.engine,
      fallbackEngine: config.fallbackEngine,
      fromLang: config.fromLang,
      toLang: config.toLang,
      llm: config.llmConfig || undefined,
    });
    console.log(chalk.green(`  ${t('settingsSaved')} ${CONFIG_FILE}`));
  }

  // ── Review mode ───────────────────────────────────────────
  const originalData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  if (isCharCard) {
    const origItems = getCharCardItems(originalData);
    const transItems = getCharCardItems(data);
    const changedItems = [];
    for (let i = 0; i < origItems.length && i < transItems.length; i++) {
      if (origItems[i].content !== transItems[i].content) changedItems.push(i);
    }

    if (changedItems.length > 0) {
      const { doReview } = await inquirer.prompt([{
        type: 'confirm', name: 'doReview',
        message: t('reviewQuestion').replace('%d', changedItems.length),
        default: false
      }]);

      if (doReview) {
        const retryQueue = [];
        let reviewIdx = 0;
        while (reviewIdx < changedItems.length) {
          const ci = changedItems[reviewIdx];
          const origLines = origItems[ci].content.split('\n').slice(0, 15);
          const transLines = transItems[ci].content.split('\n').slice(0, 15);

          console.log();
          console.log(boxen(
            chalk.bold(`${transItems[ci].label}`) + '\n\n' +
            chalk.gray(t('reviewOrig')) + '\n' +
            origLines.map(l => chalk.gray('  ' + l.substring(0, 80))).join('\n') + '\n\n' +
            chalk.cyan(t('reviewTrans')) + '\n' +
            transLines.map(l => chalk.cyan('  ' + l.substring(0, 80))).join('\n') +
            (transLines.length >= 15 ? chalk.gray('\n  ...') : ''),
            { padding: 1, borderColor: 'cyan', borderStyle: 'round', title: `${reviewIdx + 1}/${changedItems.length}` }
          ));

          const { action } = await inquirer.prompt([{
            type: 'list', name: 'action', message: t('glossAction'),
            choices: [
              { name: t('reviewNext'), value: 'next' },
              { name: t('reviewRetry'), value: 'retry' },
              { name: t('reviewQuit'), value: 'quit' },
            ],
          }]);
          if (action === 'retry') {
            retryQueue.push(ci);
            console.log(chalk.yellow('  ' + t('reviewMarked').replace('%d', ci)));
          }
          if (action === 'quit') break;
          reviewIdx++;
        }

        if (retryQueue.length > 0) {
          console.log(chalk.bold(`\n  ${t('reviewRetrying').replace('%d', retryQueue.length)}`));
          const retryTranslateFn = createTranslator(config.engine, config.fromLang, config.toLang, config.llmConfig);
          for (const ci of retryQueue) {
            console.log(`  ${origItems[ci].label}...`);
            try {
              const result = await translateContent(origItems[ci].content, retryTranslateFn, chunkSize, () => {}, glossary, concurrency);
              if (result.ok) {
                writeCharCardItem(data, origItems[ci], result.content);
                console.log(chalk.green(`    OK`));
              } else {
                console.log(chalk.red(`    Failed: ${result.reason}`));
              }
            } catch (e) {
              console.log(chalk.red(`    Error: ${e.message}`));
            }
          }
          fs.writeFileSync(outputPath, JSON.stringify(data, null, 4));
          console.log(chalk.green(`  ${t('reviewDone')}`));
        }
      }
    }
  } else {
    const changedIndices = [];
    for (let i = 0; i < data.prompts.length; i++) {
      if (data.prompts[i].content !== originalData.prompts[i].content ||
          data.prompts[i].name !== originalData.prompts[i].name) {
        changedIndices.push(i);
      }
    }

    if (changedIndices.length > 0) {
      const { doReview } = await inquirer.prompt([{
        type: 'confirm', name: 'doReview',
        message: t('reviewQuestion').replace('%d', changedIndices.length),
        default: false
      }]);

      if (doReview) {
        const retryQueue = [];
        let reviewIdx = 0;

        while (reviewIdx < changedIndices.length) {
          const pi = changedIndices[reviewIdx];
          const orig = originalData.prompts[pi];
          const trans = data.prompts[pi];

          const origLines = (orig.content || '').split('\n').slice(0, 15);
          const transLines = (trans.content || '').split('\n').slice(0, 15);

          console.log();
          console.log(boxen(
            chalk.bold(`#${pi} ${trans.name || '(marker)'}`) + '\n\n' +
            chalk.gray(t('reviewOrig')) + '\n' +
            origLines.map(l => chalk.gray('  ' + l.substring(0, 80))).join('\n') + '\n\n' +
            chalk.cyan(t('reviewTrans')) + '\n' +
            transLines.map(l => chalk.cyan('  ' + l.substring(0, 80))).join('\n') +
            (transLines.length >= 15 ? chalk.gray('\n  ...') : ''),
            { padding: 1, borderColor: 'cyan', borderStyle: 'round', title: `${reviewIdx + 1}/${changedIndices.length}` }
          ));

          const { action } = await inquirer.prompt([{
            type: 'list', name: 'action', message: t('glossAction'),
            choices: [
              { name: t('reviewNext'), value: 'next' },
              { name: t('reviewRetry'), value: 'retry' },
              { name: t('reviewQuit'), value: 'quit' },
            ],
          }]);

          if (action === 'retry') {
            retryQueue.push(pi);
            console.log(chalk.yellow('  ' + t('reviewMarked').replace('%d', pi)));
          }
          if (action === 'quit') break;
          reviewIdx++;
        }

        if (retryQueue.length > 0) {
          console.log(chalk.bold(`\n  ${t('reviewRetrying').replace('%d', retryQueue.length)}`));
          const retryTranslateFn = createTranslator(config.engine, config.fromLang, config.toLang, config.llmConfig);

          for (const pi of retryQueue) {
            const p = data.prompts[pi];
            const origP = originalData.prompts[pi];
            console.log(`  #${pi} "${(p.name || '').substring(0, 40)}"...`);

            try {
              const result = await translateContent(origP.content, retryTranslateFn, chunkSize, () => {}, glossary, concurrency);
              if (result.ok) {
                p.content = result.content;
                console.log(chalk.green(`    OK`));
              } else {
                console.log(chalk.red(`    Failed: ${result.reason}`));
              }
            } catch (e) {
              console.log(chalk.red(`    Error: ${e.message}`));
            }
          }
          fs.writeFileSync(outputPath, JSON.stringify(data, null, 4));
          console.log(chalk.green(`  ${t('reviewDone')}`));
        }
      }
    }
  }
}

main().catch(err => {
  logUpdate.clear();
  console.error(chalk.red('Fatal error:'), err.message);
  process.exit(1);
});
