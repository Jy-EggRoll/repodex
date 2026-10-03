# Porting the l10n setup to another repository

English | [简体中文](./l10n-checklist.zh-cn.md)

This repo's localization has two halves: the part specific to this codebase, and the part that is a reusable pattern. This document is the second half — a checklist for reproducing the setup elsewhere. For how localization works _here_ (bundle layout, runtime wiring, adding a string), see [Internationalization](../README.md#internationalization) in the README.

## Separate the layers first

The setup is not one decision, it is four, and their portability differs a lot:

| Layer          | What it is                                                                                  | Portable                                                    |
| -------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bundle format  | `l10n/bundle.l10n.json` identity map + `l10n/bundle.l10n.<locale>.json`, `{0}` placeholders | Yes, with conditions (see below)                            |
| Runtime wiring | i18next + language detection + pre-paint `lang`                                             | Only the shape; the runtime is framework-specific           |
| Enforcement    | The test assertions and the sort script                                                     | Yes — the most valuable and the most stack-independent part |
| Wire contract  | Error codes that double as translation keys                                                 | Yes, but only with a single shared source of codes          |

The bundle format is not invented here: English source strings as keys and an English-to-English identity map is the VS Code l10n convention. The format and the extraction tooling that goes with it are documented in the `@vscode/l10n-dev` README: <https://github.com/microsoft/vscode-l10n>.

## The checklist

1. **Bundle layout.** `l10n/bundle.l10n.json` holds the source language as an identity map, so it doubles as the registry of every known key. One `l10n/bundle.l10n.<locale>.json` per locale.
2. **A single translate entry point.** Export one `t(key, options)` and have every call site go through it (components included). Two entry points mean two things to keep in sync.
3. **Assertion: every locale has the same key set.** Cheapest possible guard against a half-finished translation.
4. **Assertion: the source bundle is an identity map** (`value === key` for every entry). This stops someone from "fixing" the source bundle instead of the locale bundle.
5. **Assertion: `{n}` placeholders match between the key and each translation.** This is the one that catches breakage that only shows up at runtime — a translation that drops or duplicates a placeholder.
6. **Assertion: runtime-computed keys are closed.** See [Dynamic keys](#dynamic-keys-the-gap-that-is-easiest-to-miss) below. This is the item most likely to be missing, and it is the one this repo gained last.
7. **A sort script** over the bundles, so a diff reflects real changes instead of ordering noise.
8. **Set `lang` before first paint** (an inline script in the HTML entry). Only needed if a wrong first frame is actually visible; skip it otherwise.

Items 3 to 7 are plain assertions and conventions with no framework dependency. Item 2 and item 8 change shape with the framework.

## Dynamic keys: the gap that is easiest to miss

A "dynamic key" is a string that is computed at runtime and passed to `t()`, so a scan for literal `t("...")` calls cannot see it. Two kinds show up in practice:

- **Wire values.** The server returns an `error` field; the client translates it verbatim with `t(body.error)`. Every server error code is therefore a translation key, defined in a different file, in a different language runtime, by a different author.
- **Enum labels.** A `labelKey` field on a config object, translated as `t(meta.labelKey)`.

The literal scan is blind to both. In this repo that silence had a cost: the server code `repo_index_kv binding is not available` was returned from four call sites and had no translation in any bundle, so a Chinese UI showed that raw English string.

The fix is structural, not a patch: **give every dynamic key one enumerable source, then walk that source in a test.**

- Put the codes in a single shared constant table that both the server and the test import — here, `ERROR_CODES` in [`src/types.ts`](../src/types.ts), the module that already holds the shared wire types. Narrow the parameter type (`errorOutcome(status, error: ErrorCode)`) so a new call site cannot invent a code that no bundle knows about.
- Walk the table in the test and assert each code exists in _every_ bundle — here, "translates every server error code" in [`src/client/i18n.test.ts`](../src/client/i18n.test.ts).

**Never send an exception message to the client as an error code.** `String(err)` in a `catch` block hands the UI a string no bundle can translate and leaks internals into a user-visible message. Log the detail server-side and return one stable code — here, `ERROR_CODES.internalError`.

## Prove the guard can actually fail

An assertion that has never been seen failing is not evidence. After wiring up item 3 or item 6, delete one translation on purpose and confirm the suite goes red naming the missing key:

```
zh-cn missing: kvUnavailable -> "repo_index_kv binding is not available"
```

Restore the translation and confirm the suite is green again. This step is skipped often, and it is the only way to know the guard covers the case you think it covers.

## When this paradigm is the wrong choice

- **Languages with complex plural rules** (Russian, Arabic, Polish, Czech). "English sentence as key" plus `{0}` placeholders gives up the runtime's plural support: i18next selects plural forms through a `count` option and `_one` / `_other` / `_few` / `_many` suffixed keys (<https://www.i18next.com/translation-function/plurals>), and the identity-map assertion in item 4 makes suffixed keys impossible. ICU MessageFormat is the standard answer, with `plural` and `select` arguments inside a single message and translators adding the forms their language needs (<https://unicode-org.github.io/icu/userguide/format_parse/messages/>).
- **Large string counts, or a translation platform in the loop.** Rewording an English sentence invalidates that key in every locale. At scale, semantic keys (`search.placeholder`) are easier to keep and to round-trip through a translation system.
- **Frequent copy churn.** Same reason at small scale, just cheaper to live with.

## What changes per stack

Only one step is genuinely stack-bound: **finding the referenced keys in source**. Here it is Vite's `import.meta.glob(..., { query: "?raw" })` reading the client sources at test time. In another frontend the equivalent glob applies; outside JavaScript you write a small scanner. Everything else in the checklist is convention and assertion, and carries over unchanged.
