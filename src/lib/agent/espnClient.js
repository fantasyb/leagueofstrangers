/**
 * ESPN Stats Client
 *
 * Fetches real NFL player stats from ESPN's free public API.
 * Handles Sleeper→ESPN ID mapping via name/team matching.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_SEARCH = 'https://site.api.espn.com/apis/common/v3/search';

// Cache for ESPN data
let espnIdCache = {};
let espnIdCacheTime = 0;
let statsCache = {};
let statsCacheTime = 0;
const CACHE_TTL = 4 * 3600000; // 4 hours

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

/**
 * Search ESPN for a player and return their ESPN athlete ID.
 */
export async function findEspnPlayerId(playerName) {
    const cached = espnIdCache[playerName];
    if (cached && (Date.now() - espnIdCacheTime) < CACHE_TTL) return cached;

    const data = await fetchJSON(
        `${ESPN_SEARCH}?query=${encodeURIComponent(playerName)}&limit=5&type=player&sport=football&league=nfl`
    );

    if (!data?.results?.[0]?.results?.[0]) return null;

    const result = data.results[0].results[0];
    const id = result.id || result.uid?.split(':').pop();
    if (id) {
        espnIdCache[playerName] = id;
        espnIdCacheTime = Date.now();
    }
    return id;
}

/**
 * Fetch season stats for a player from ESPN.
 * Returns normalized stats object.
 */
export async function getPlayerSeasonStats(espnId) {
    if (!espnId) return null;

    const cacheKey = `stats_${espnId}`;
    if (statsCache[cacheKey] && (Date.now() - statsCacheTime) < CACHE_TTL) {
        return statsCache[cacheKey];
    }

    const data = await fetchJSON(`${ESPN_BASE}/athletes/${espnId}/stats`);
    if (!data) return null;

    const stats = parseEspnStats(data);
    if (stats) {
        statsCache[cacheKey] = stats;
        statsCacheTime = Date.now();
    }
    return stats;
}

/**
 * Parse ESPN stats response into a normalized format.
 */
function parseEspnStats(data) {
    if (!data?.categories) return null;

    const stats = {
        gamesPlayed: 0,
        passing: {},
        rushing: {},
        receiving: {},
        seasonYear: null,
    };

    for (const category of data.categories) {
        const catName = category.name?.toLowerCase() || '';
        if (!category.statistics) continue;

        for (const stat of category.statistics) {
            const splits = stat.splits;
            if (!splits?.length) continue;

            // Get the most recent season
            const season = splits[0];
            if (!season?.stats) continue;

            stats.seasonYear = season.season?.year || stats.seasonYear;

            if (catName === 'passing' || catName === 'general') {
                mapStatValues(stats.passing, stat.abbreviation, season.stats);
            }
            if (catName === 'rushing') {
                mapStatValues(stats.rushing, stat.abbreviation, season.stats);
            }
            if (catName === 'receiving') {
                mapStatValues(stats.receiving, stat.abbreviation, season.stats);
            }
        }
    }

    return stats;
}

/**
 * Alternative parsing approach - ESPN often returns stats in tabular format.
 */
function mapStatValues(target, abbrev, values) {
    if (!abbrev || !values?.length) return;
    target[abbrev] = values[0];
}

/**
 * Fetch player stats using the team roster endpoint (more reliable).
 * Returns stats for all players on a team.
 */
export async function getTeamRosterStats(teamAbbrev) {
    const teamId = TEAM_ABBREV_TO_ESPN_ID[teamAbbrev?.toUpperCase()];
    if (!teamId) return null;

    const cacheKey = `team_${teamAbbrev}`;
    if (statsCache[cacheKey] && (Date.now() - statsCacheTime) < CACHE_TTL) {
        return statsCache[cacheKey];
    }

    const data = await fetchJSON(`${ESPN_BASE}/teams/${teamId}/roster`);
    if (!data?.athletes) return null;

    const playerStats = {};
    for (const group of data.athletes) {
        for (const athlete of group.items || []) {
            playerStats[athlete.fullName?.toLowerCase()] = {
                espnId: athlete.id,
                name: athlete.fullName,
                position: athlete.position?.abbreviation,
                age: athlete.age,
                experience: athlete.experience?.years,
                jersey: athlete.jersey,
            };
        }
    }

    statsCache[cacheKey] = playerStats;
    statsCacheTime = Date.now();
    return playerStats;
}

/**
 * Bulk fetch player stats from ESPN's athlete endpoint.
 * More efficient for getting stats for many players.
 */
export async function getSeasonLeaders(season = 2025) {
    const cacheKey = `leaders_${season}`;
    if (statsCache[cacheKey] && (Date.now() - statsCacheTime) < CACHE_TTL) {
        return statsCache[cacheKey];
    }

    const positions = ['quarterback', 'runningback', 'widereceiver', 'tightend'];
    const allStats = {};

    const promises = positions.map(async (pos) => {
        const data = await fetchJSON(
            `${ESPN_BASE}/statistics/players?season=${season}&position=${pos}&limit=100`
        );
        if (!data?.athletes) return;

        for (const athlete of data.athletes) {
            const name = athlete.athlete?.displayName?.toLowerCase();
            if (!name) continue;

            const statMap = {};
            if (athlete.categories) {
                for (const cat of athlete.categories) {
                    if (cat.values?.length && cat.names?.length) {
                        for (let i = 0; i < cat.names.length; i++) {
                            statMap[cat.names[i]] = cat.values[i];
                        }
                    }
                }
            }

            // Also parse from stat line format
            if (athlete.stats?.length && athlete.statHeaders?.length) {
                for (let i = 0; i < athlete.statHeaders.length; i++) {
                    statMap[athlete.statHeaders[i]] = athlete.stats[i];
                }
            }

            allStats[name] = {
                espnId: athlete.athlete?.id,
                name: athlete.athlete?.displayName,
                team: athlete.athlete?.teamShortName || athlete.team?.abbreviation,
                position: pos === 'quarterback' ? 'QB' :
                         pos === 'runningback' ? 'RB' :
                         pos === 'widereceiver' ? 'WR' : 'TE',
                stats: statMap,
            };
        }
    });

    await Promise.all(promises);
    statsCache[cacheKey] = allStats;
    statsCacheTime = Date.now();
    return allStats;
}

/**
 * Get normalized stats for a player by name.
 * Tries season leaders first (cached), falls back to individual lookup.
 */
export async function getPlayerStats(playerName, season = 2025) {
    const leaders = await getSeasonLeaders(season);
    const key = playerName?.toLowerCase();

    if (leaders?.[key]) return leaders[key];

    // Fallback: try ESPN search + individual stats
    const espnId = await findEspnPlayerId(playerName);
    if (espnId) {
        const stats = await getPlayerSeasonStats(espnId);
        return stats ? { espnId, name: playerName, stats } : null;
    }

    return null;
}

/**
 * Map NFL team abbreviations to ESPN team IDs.
 */
const TEAM_ABBREV_TO_ESPN_ID = {
    ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3,
    CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9,
    HOU: 34, IND: 11, JAX: 30, KC: 12, LV: 13, LAC: 24,
    LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
    NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27,
    TEN: 10, WAS: 28,
};

export { TEAM_ABBREV_TO_ESPN_ID };
