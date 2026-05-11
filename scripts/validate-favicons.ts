// Validate icon URLs across all integrations. Caches results to
// output/favicons.json so re-runs only revisit URLs that haven't been seen
// (or the --refresh flag is passed).
//
//   bun run validate-favicons               # check uncached URLs
//   bun run validate-favicons -- --refresh  # recheck everything
//   bun run validate-favicons -- --concurrency=20 --timeout=8000
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Integration } from "../src/lib/types.ts";

const ROOT = import.meta.dir.replace(/\/scripts$/, "");
const OUTPUT = join(ROOT, "output");
const CACHE_PATH = join(OUTPUT, "favicons.json");

const args = new Map<string, string>(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [[m[1], m[2] ?? "true"]] : [];
  }),
);
const REFRESH = args.has("refresh");
const CONCURRENCY = Number(args.get("concurrency") ?? 24);
const TIMEOUT_MS = Number(args.get("timeout") ?? 8000);

interface IconStatus {
  ok: boolean;
  status?: number;
  error?: string;
  checkedAt: string;
}

type Cache = Record<string, IconStatus>;

function loadCache(): Cache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function saveCache(c: Cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2));
}

async function pmap<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

async function check(url: string): Promise<IconStatus> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "integrations.sh favicon-checker" },
    });
    // Some CDNs disallow HEAD. Try a 1-byte ranged GET on 4xx/5xx.
    if (!res.ok && res.status !== 404) {
      res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "user-agent": "integrations.sh favicon-checker", range: "bytes=0-0" },
      });
    }
    const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
    const isImage = ctype.startsWith("image/") || ctype === "application/octet-stream";
    return {
      ok: res.ok && isImage,
      status: res.status,
      error: res.ok && !isImage ? `not-image: ${ctype.split(";")[0] || "?"}` : undefined,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).name === "AbortError" ? "timeout" : (e as Error).message.slice(0, 120),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(t);
  }
}

function loadIcons(): Set<string> {
  const urls = new Set<string>();
  for (const file of ["mcp.json", "openapi.json", "graphql.json"]) {
    const p = join(OUTPUT, file);
    if (!existsSync(p)) continue;
    const recs = JSON.parse(readFileSync(p, "utf8")) as Integration[];
    for (const r of recs) {
      if (!r.icon || !/^https?:\/\//.test(r.icon)) continue;
      // Skip our own fallback service — those are always valid by construction
      // and revalidating them spams the favicon endpoint.
      if (r.icon.startsWith("https://www.google.com/s2/favicons")) continue;
      urls.add(r.icon);
    }
  }
  return urls;
}

async function main() {
  const cache = loadCache();
  const allIcons = [...loadIcons()];
  const work = REFRESH ? allIcons : allIcons.filter((u) => !(u in cache));
  console.log(
    `${allIcons.length} unique icon URLs; ${work.length} to check (${allIcons.length - work.length} cached)`,
  );

  let ok = 0, bad = 0;
  let started = Date.now();
  let writtenAt = started;
  await pmap(work, CONCURRENCY, async (url, i) => {
    const result = await check(url);
    cache[url] = result;
    if (result.ok) ok++;
    else bad++;
    if ((i + 1) % 100 === 0 || i + 1 === work.length) {
      const dt = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  [${i + 1}/${work.length}] ok=${ok} bad=${bad} (${dt}s)`);
    }
    // Periodic checkpoint so a Ctrl-C doesn't lose progress.
    if (Date.now() - writtenAt > 5000) {
      saveCache(cache);
      writtenAt = Date.now();
    }
  });
  saveCache(cache);

  const totalOk = Object.values(cache).filter((s) => s.ok).length;
  const totalBad = Object.values(cache).filter((s) => !s.ok).length;
  console.log(`done. cache: ok=${totalOk} bad=${totalBad}`);
}

await main();
