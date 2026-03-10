/**
 * FantasyCalc Client
 *
 * Fetches dynasty trade values from FantasyCalc.com's public API.
 * FantasyCalc aggregates user trade data from Sleeper, MFL, and Fleaflicker
 * to produce crowd-sourced dynasty values. This is a second consensus source
 * alongside KTC to triangulate true market value.
 *
 * API: https://api.fantasycalc.com/values/current
 * Params: isDynasty=true, numQbs=2 (superflex), numTeams=12, ppr=1
 */

const FC_BASE = 'https://api.fantasycalc.com';

// Cache
let fcCache = null;
let fcCacheTime = 0;
const FC_CACHE_TTL = 4 * 3600000; // 4 hours

async function fetchJSON(url) {
    try {
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'DynastyManager/1.0',
            },
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/**
 * Fetch all FantasyCalc dynasty values.
 * Configurable for league format (SF, PPR, team count).
 */
export async function getFantasyCalcValues(options = {}) {
    const {
        isDynasty = true,
        numQbs = 2,       // 2 = Superflex
        numTeams = 12,
        ppr = 1,           // 1 = full PPR, 0.5 = half PPR
    } = options;

    const now = Date.now();
    const cacheKey = `${isDynasty}_${numQbs}_${numTeams}_${ppr}`;

    if (fcCache?.key === cacheKey && (now - fcCacheTime) < FC_CACHE_TTL) {
        return fcCache.data;
    }

    const params = new URLSearchParams({
        isDynasty: isDynasty.toString(),
        numQbs: numQbs.toString(),
        numTeams: numTeams.toString(),
        ppr: ppr.toString(),
    });

    const data = await fetchJSON(`${FC_BASE}/values/current?${params}`);
    if (!data || !Array.isArray(data)) return null;

    const values = {};

    for (const entry of data) {
        const player = entry.player;
        if (!player?.name) continue;

        const key = normalizePlayerName(player.name);
        values[key] = {
            name: player.name,
            value: entry.value || 0,                    // FantasyCalc value
            overallRank: entry.overallRank || null,
            positionRank: entry.positionRank || null,
            position: player.position || null,
            team: player.maybeTeam || player.team || null,
            age: player.age || null,
            espnId: player.espnId || null,
            sleeperId: player.sleeperId || null,
            mflId: player.mflId || null,
            // FantasyCalc provides both redraft and dynasty values
            redraftValue: entry.redraftValue || null,
        };
    }

    fcCache = { key: cacheKey, data: values };
    fcCacheTime = now;
    return values;
}

/**
 * Look up a single player's FantasyCalc value by name.
 */
export async function getFantasyCalcPlayerValue(playerName, options = {}) {
    const values = await getFantasyCalcValues(options);
    if (!values) return null;

    const key = normalizePlayerName(playerName);

    // Exact match
    if (values[key]) return values[key];

    // Try without suffixes
    const stripped = key.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '');
    if (values[stripped]) return values[stripped];

    // Partial match
    for (const vKey in values) {
        if (vKey.includes(key) || key.includes(vKey)) {
            return values[vKey];
        }
    }

    return null;
}

/**
 * Get FantasyCalc values matched to Sleeper player IDs.
 * Uses sleeperId from FantasyCalc when available, falls back to name matching.
 */
export async function getFantasyCalcBySleeperIds(playerData, options = {}) {
    const values = await getFantasyCalcValues(options);
    if (!values) return {};

    // Build reverse map: sleeperId -> FC data
    const sleeperIdMap = {};
    for (const key in values) {
        const fc = values[key];
        if (fc.sleeperId) {
            sleeperIdMap[fc.sleeperId] = fc;
        }
    }

    const result = {};

    for (const pid in playerData) {
        const p = playerData[pid];
        if (!p.fn || !p.ln) continue;

        // Try Sleeper ID match first (most reliable)
        if (sleeperIdMap[pid]) {
            result[pid] = sleeperIdMap[pid];
            continue;
        }

        // Fall back to name match
        const name = normalizePlayerName(`${p.fn} ${p.ln}`);
        if (values[name]) {
            result[pid] = values[name];
            continue;
        }

        // Try without suffix
        const stripped = name.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '');
        if (values[stripped]) {
            result[pid] = values[stripped];
        }
    }

    return result;
}

/**
 * Normalize a player name for matching.
 */
function normalizePlayerName(name) {
    return name
        .toLowerCase()
        .replace(/[.']/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export { normalizePlayerName as normalizeFCName };
