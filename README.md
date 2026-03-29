# preset-translate

CLI tool for translating [SillyTavern](https://github.com/SillyTavern/SillyTavern) preset JSON files between languages while preserving macro syntax, regex scripts, and chain systems intact.

## Features

- Translates `prompts[].content` fields and regex script names/replaceStrings
- Protects macros (`{{char}}`, `{{user}}`, etc.), code blocks, and regex chain markers from translation
- Three translation engines: Bing, Google, LLM (OpenAI-compatible)
- Engine cascade fallback: primary fails → secondary takes over, chunk mode fails → linewise
- Parallel requests with configurable concurrency
- Glossary: user-defined term overrides
- Incremental save after each prompt — safe to interrupt
- Resume detection: restarts from where it left off if output file already exists
- Post-translation review mode with per-prompt retry
- Interface language: English / Русский / 中文
- Config persistence in `.translaterc.json`

## Requirements

- Node.js 18+

## Usage

```
node preset-translate.js
```

Or on Windows:

```
start.bat
```

On first run, the wizard asks for engine, language pair, and (for LLM) API credentials. Settings are saved to `.translaterc.json` and pre-filled on next run.

### Proxy

Set `HTTPS_PROXY` or `HTTP_PROXY` before running:

```
HTTPS_PROXY=http://127.0.0.1:7890 node preset-translate.js
```

### Dry run

```
node preset-translate.js --dry-run
```

Scans the preset and shows which prompts would be translated without making any API calls.

## How it works

Macro placeholders (`{{char}}`, `{{user}}`, `<START>`, etc.) are replaced with numeric tokens before translation and restored afterward. Code blocks surrounded by triple backticks are protected in full.

Regex `replaceString` fields are translated using the same cascade. `findRegex` fields are never touched. Chinese-character sequences appearing in any `findRegex` are added to the glossary as identity-mapped terms before translation, preventing cross-script chain markers from being altered.

## License

MIT
