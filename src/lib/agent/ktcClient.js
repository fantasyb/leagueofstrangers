/**
 * KeepTradeCut Client
 *
 * Fetches dynasty consensus trade values from KeepTradeCut.
 * KTC is the most widely-used dynasty trade value reference.
 * Values are on a 0-9999 scale (we normalize to our 0-10000 scale).
 *
 * Endpoints:
 *   - /api/v1/players - All dynasty player values
 *   - /api/v1/players/rankings - Ranked player list
 */

const KTC_BASE = 'https://keeptradecut.com';

// Cache
let ktcCache = null;
let ktcCacheTime = 0;
const KTC_CACHE_TTL = 4 * 3600000; // 4 hours

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
 * Fetch all KTC dynasty player values.
 * Returns a map keyed by normalized player name (lowercase).
 */
export async function getKTCValues() {
    const now = Date.now();
    if (ktcCache && (now - ktcCacheTime) < KTC_CACHE_TTL) {
        return ktcCache;
    }

    // KTC exposes player values via their rankings endpoint
    const data = await fetchJSON(`${KTC_BASE}/api/v1/players`);
    if (!data || !Array.isArray(data)) return null;

    const values = {};

    for (const player of data) {
        if (!player.playerName) continue;

        const key = normalizePlayerName(player.playerName);
        values[key] = {
            name: player.playerName,
            value: player.value || 0,           // KTC's raw value (0-9999)
            superflexValue: player.superflexValue || player.value || 0,
            position: mapKTCPosition(player.position),
            team: player.team || null,
            age: player.age || null,
            rookie: player.rookie || false,
            rank: player.overallRank || null,
            positionRank: player.positionRank || null,
            trend7Day: player.trend7Day || 0,   // 7-day value change
            trend30Day: player.trend30Day || 0, // 30-day value change
        };
    }

    ktcCache = values;
    ktcCacheTime = now;
    return values;
}

/**
 * Look up a single player's KTC value by name.
 * Tries exact match first, then fuzzy.
 */
export async function getKTCPlayerValue(playerName) {
    const values = await getKTCValues();
    if (!values) return null;

    const key = normalizePlayerName(playerName);

    // Exact match
    if (values[key]) return values[key];

    // Try without Jr/Sr/III suffixes
    const stripped = key.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '');
    if (values[stripped]) return values[stripped];

    // Fuzzy: find closest match
    for (const vKey in values) {
        if (vKey.includes(key) || key.includes(vKey)) {
            return values[vKey];
        }
    }

    return null;
}

/**
 * Get KTC values for all players on a roster.
 * Takes an array of { id, name } objects.
 */
export async function getKTCRosterValues(rosterPlayers) {
    const values = await getKTCValues();
    if (!values) return {};

    const result = {};
    for (const player of rosterPlayers) {
        if (!player.name) continue;
        const key = normalizePlayerName(player.name);
        const ktcData = values[key]
            || values[key.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')]
            || null;

        if (ktcData) {
            result[player.id] = ktcData;
        }
    }

    return result;
}

/**
 * Get the top dynasty players according to KTC.
 */
export async function getKTCTopPlayers(limit = 100, position = null) {
    const values = await getKTCValues();
    if (!values) return [];

    let players = Object.values(values);

    if (position) {
        players = players.filter(p => p.position === position);
    }

    return players
        .sort((a, b) => b.superflexValue - a.superflexValue)
        .slice(0, limit);
}

/**
 * Get KTC trending players (biggest risers/fallers).
 */
export async function getKTCTrending(direction = 'up', limit = 20) {
    const values = await getKTCValues();
    if (!values) return [];

    const players = Object.values(values).filter(p => p.trend30Day !== 0);

    if (direction === 'up') {
        return players
            .sort((a, b) => b.trend30Day - a.trend30Day)
            .slice(0, limit);
    }

    return players
        .sort((a, b) => a.trend30Day - b.trend30Day)
        .slice(0, limit);
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

/**
 * Map KTC position labels to standard abbreviations.
 */
function mapKTCPosition(pos) {
    if (!pos) return null;
    const upper = pos.toUpperCase();
    if (upper === 'QB' || upper === 'QUARTERBACK') return 'QB';
    if (upper === 'RB' || upper === 'RUNNING BACK') return 'RB';
    if (upper === 'WR' || upper === 'WIDE RECEIVER') return 'WR';
    if (upper === 'TE' || upper === 'TIGHT END') return 'TE';
    if (upper === 'PI' || upper === 'PICK') return 'PICK';
    return upper;
}

export { normalizePlayerName };
