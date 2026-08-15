# @deepseek-ai/dsh-usage-stats

Accurate API usage statistics for DSH Web: tokens, requests, completed turns, active days, average cache hit rate, top model, cost estimates and account balance. It subscribes to the host-side `session/event` stream (global), folds precise provider `usage` reports into daily and per-model buckets, persists the aggregate to disk, and exposes a read-only loopback-fenced HTTP API that drives the settings-page statistics card in the browser.

Unlike heuristic estimators, the token counts here are exact: they come from each request's provider `usage` report (`inputTokens`/`outputTokens` plus `cacheReadTokens`/`cacheWriteTokens`), with the same `(turn, step)` replacement semantics DSH itself uses so a final message replaces its earlier usage chunk instead of double counting.

## What it does

- **Host half**: subscribes to `session/event` (global, all sessions) and folds each request into a `UsageStatsMeter`: tokens, requests, completed turns, cost, and recent-request metadata. Daily (`YYYY-MM-DD`, local timezone) and per-model buckets feed range queries. The aggregate is persisted to `~/.dsh/dsh-usage-stats.json` with debounced writes (30s) plus an immediate write on `session/flush` (throttled) and on dispose. Atomic `tmp + rename` writes keep the file safe under crash; a corrupt or version-mismatched file is moved to `.bak` and rebuilt from empty. Read-only routes under `/api/dsh-usage-stats/*` are guarded by a loopback fence so only local pages can read them. Balance is fetched from the provider's balance endpoint, auto-detected for DeepSeek or set manually.
- **Browser half**: registers the settings-page statistics card as a standalone plugin card (official `settings.plugin.item` slot, id `usage-stats`; it is NOT part of any family group such as `web-ui.plugin.item`). It offers 7/14/30/90-day plus custom range presets and shows an overview (token split and total, completed turns, requests, active days, average cache hit rate, top model, range cost, unpriced requests), a today/session digest, a CSS trend bar chart from the query series, a per-model table, and an account balance panel with manual refresh. It polls the host API every 30s while mounted.

## Installation

Standalone plugin, independent of the dsh-web-ui family and its aggregate package. Install directly into the web profile:

```sh
dsh plugin --profile web add link:<dsh-web-ui>/packages/dsh-usage-stats
```

Then restart `dsh web`. Alternatively, add to the personal DSH overlay (`~/.dsh/config.yaml`), hot-reloaded on save:

```yaml
- insert:
    - id: usage-stats
      name: '@deepseek-ai/dsh-usage-stats'
      config:
        enabled: true
        currency: CNY
        balance:
          mode: auto
          refreshMs: 600000
```

All configuration is optional (defaults shown below).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch; when off, event subscription, persistence and meter mounting stop |
| `prices` | `Record<string, ModelPrice>` | built-in DeepSeek table | Per-million-token unit prices keyed by model (`input` / `cacheRead` / `cacheWrite` / `output`); user entries override the built-in table |
| `defaultPrice` | `ModelPrice` | none | Fallback price for models not in `prices`; absent, unknown models are priced at 0 |
| `currency` | `string` | `CNY` | Display currency label for cost and balance |
| `balance.mode` | `'auto' | 'manual' | 'off'` | `auto` infers the endpoint from the current default provider (DeepSeek); `manual` uses `baseUrl`; `off` disables balance fetching |
| `balance.baseUrl` | `string` | none | Balance endpoint origin (required for `manual`) |
| `balance.path` | `string` | `/user/balance` | Balance path appended to `baseUrl` |
| `balance.apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | Environment variable holding the provider API key |
| `balance.refreshMs` | `number` | `600000` | Balance refresh interval in milliseconds (min 1000) |

`ModelPrice` is an object `{ input, cacheRead, cacheWrite, output }` with non-negative numbers. Built-in DeepSeek prices: `deepseek-chat` `{ input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 }`; `deepseek-reasoner` `{ input: 4, cacheRead: 1, cacheWrite: 4, output: 16 }` (per million tokens, CNY).

## Export shape

A function/namespace plugin: `inject` / `Config` / `apply`, no default export. The host entry also exports `USAGE_STATS_METER_KEY` (a symbol the host attaches to the context for the routes and balance task to read the live meter) and `USAGE_STATS_SETTINGS_NAMESPACE`. The meter, pricing, store, query and provider-detection modules are pure and unit-tested.

## Model Experience

### Prompt and tool surface

#### What the model sees

Nothing. The plugin injects no prompt sections and registers no tools. It only consumes the durable `session/event` stream and exposes read-only HTTP routes; the browser card renders through the official `settings.plugin.item` slot.

#### Token effect

Zero per request.

#### KV Cache effect

No system-prompt contribution, so no cache-stability effect.

## Known Limitations and Deferred Work

- **Cost is an estimate**: fees are computed from the built-in or user price table against provider-reported usage, not from the billing provider's invoice; verify against your actual statement.
- **Balance depends on the provider endpoint**: `auto` detection only recognizes DeepSeek (`api.deepseek.com` or any `.deepseek.com` host) and requires the provider profile to expose a `baseURL`; other providers need `manual` mode, and the endpoint may reject third-party keys.
- **History starts at enable time**: the daily aggregate records only events observed after the plugin was enabled; past usage before then is not backfilled.
- **Retention**: `byDay` keeps the most recent 730 days and `sessions` keeps the most recent 500; older data is trimmed on save.
