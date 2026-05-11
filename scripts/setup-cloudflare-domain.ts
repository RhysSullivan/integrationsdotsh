#!/usr/bin/env bun
/**
 * One-shot: move integrations.sh from Vercel nameservers to Cloudflare,
 * then deploy the worker so custom-domain routes attach.
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN  — User API Token w/ Zone:Edit + Account:Read
 *
 * Reads Vercel auth from ~/.local/share/com.vercel.cli/auth.json + config.json.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DOMAIN = "integrations.sh";
const CF_ACCOUNT_ID = "6691acaf4b3f35d16446cce82110a6c5";

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
if (!cfToken) {
  console.error(
    "Missing CLOUDFLARE_API_TOKEN. Create one at https://dash.cloudflare.com/profile/api-tokens",
  );
  console.error("Required permissions: Zone:Edit, Account:Read");
  process.exit(1);
}

const vcDir = join(homedir(), ".local/share/com.vercel.cli");
const vcAuth = JSON.parse(readFileSync(join(vcDir, "auth.json"), "utf8")) as {
  token: string;
};
const vcConfig = JSON.parse(readFileSync(join(vcDir, "config.json"), "utf8")) as {
  currentTeam?: string;
};
const vcToken = vcAuth.token;
const vcTeam = vcConfig.currentTeam;
if (!vcToken) throw new Error("No Vercel CLI token found");

const cf = async (path: string, init?: RequestInit) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await r.json()) as {
    success: boolean;
    errors?: Array<{ code: number; message: string }>;
    result?: unknown;
  };
  if (!json.success) {
    throw new Error(`CF ${path}: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
};

const vc = async (path: string, init?: RequestInit) => {
  const url = new URL(`https://api.vercel.com${path}`);
  if (vcTeam) url.searchParams.set("teamId", vcTeam);
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${vcToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Vercel ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

type Zone = {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
  original_name_servers?: string[];
};

async function findOrCreateZone(): Promise<Zone> {
  const list = (await cf(`/zones?name=${DOMAIN}`)) as Zone[];
  if (list.length > 0) {
    console.log(`Zone exists: id=${list[0]!.id} status=${list[0]!.status}`);
    return list[0]!;
  }
  console.log(`Creating CF zone for ${DOMAIN}…`);
  const created = (await cf(`/zones`, {
    method: "POST",
    body: JSON.stringify({
      name: DOMAIN,
      account: { id: CF_ACCOUNT_ID },
      type: "full",
    }),
  })) as Zone;
  console.log(`Created: id=${created.id}`);
  return created;
}

async function setVercelNameservers(nameservers: string[]) {
  const current = (await vc(`/v6/domains/${DOMAIN}`)) as {
    domain: { nameservers: string[] };
  };
  const cur = current.domain.nameservers ?? [];
  const same =
    cur.length === nameservers.length &&
    cur.every((n) => nameservers.includes(n));
  if (same) {
    console.log("Vercel nameservers already match CF — skipping.");
    return;
  }
  console.log(
    `Vercel NS: [${cur.join(", ")}] → [${nameservers.join(", ")}]`,
  );
  await vc(`/v5/domains/${DOMAIN}`, {
    method: "PATCH",
    body: JSON.stringify({ op: "update", customNameservers: nameservers }),
  });
  console.log("Vercel registrar updated.");
}

async function pollActivation(zoneId: string) {
  for (let i = 0; i < 60; i++) {
    const z = (await cf(`/zones/${zoneId}`)) as Zone;
    console.log(`[${i + 1}/60] zone status: ${z.status}`);
    if (z.status === "active") return;
    if (i === 2 || i % 6 === 5) {
      try {
        await cf(`/zones/${zoneId}/activation_check`, { method: "PUT" });
        console.log("  → activation_check triggered");
      } catch (e) {
        console.log(`  → activation_check skipped: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error("Zone did not become active within 30 minutes");
}

async function main() {
  const zone = await findOrCreateZone();
  const ns = zone.name_servers ?? [];
  if (ns.length === 0) throw new Error("CF returned no nameservers");
  console.log(`CF assigned NS: ${ns.join(", ")}`);

  await setVercelNameservers(ns);

  if (zone.status !== "active") {
    console.log("Polling for zone activation (NS propagation can take a few min)…");
    await pollActivation(zone.id);
  }

  console.log("\nZone active. Running wrangler deploy…");
  const r = spawnSync("bunx", ["wrangler", "deploy"], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

await main();
