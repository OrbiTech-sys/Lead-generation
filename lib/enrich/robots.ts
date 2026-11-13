import { safeFetch } from "./http";

interface Rules {
  allow: string[];
  disallow: string[];
}

const cache = new Map<string, { rules: Rules | null; at: number }>();
const TTL = 60 * 60 * 1000;

/** Parse robots.txt for our bot token (falls back to `*`). Longest-match wins; Allow beats Disallow on ties. */
export function parseRobots(text: string, agentToken = "orbitechleadbot"): Rules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === "allow") cur.allow.push(val);
      else if (key === "disallow") cur.disallow.push(val);
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow).filter(Boolean),
    disallow: chosen.flatMap((g) => g.disallow).filter(Boolean),
  };
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return re.test(path);
}

export function isAllowedByRules(rules: Rules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const a of rules.allow) if (matches(a, path)) bestAllow = Math.max(bestAllow, a.length);
  for (const d of rules.disallow) if (matches(d, path)) bestDisallow = Math.max(bestDisallow, d.length);
  return bestAllow >= bestDisallow;
}

/** True when our crawler may fetch this URL. Missing/unreachable robots.txt => allowed (standard behaviour); 401/403 => disallowed. */
export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  const origin = u.origin;
  const hit = cache.get(origin);
  let rules: Rules | null;
  if (hit && Date.now() - hit.at < TTL) {
    rules = hit.rules;
  } else {
    rules = { allow: [], disallow: [] };
    try {
      const res = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000 });
      if (res.status === 401 || res.status === 403) rules = { allow: [], disallow: ["/"] };
      else if (res.ok) rules = parseRobots(res.body);
    } catch {
      /* unreachable robots.txt: treat as no restrictions */
    }
    cache.set(origin, { rules, at: Date.now() });
  }
  return isAllowedByRules(rules!, u.pathname + u.search);
}
