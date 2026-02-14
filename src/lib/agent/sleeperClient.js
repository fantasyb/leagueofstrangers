/**
 * Enhanced Sleeper API client for the AI Dynasty Manager.
 * Server-side fetching for league data, rosters, players, matchups, and transactions.
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const SLEEPER_PROJ = 'https://api.sleeper.app/projections';

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sleeper API error: ${res.status} ${url}`);
    return res.json();
}

export async function getNflState() {
    return fetchJSON(`${SLEEPER_BASE}/state/nfl`);
}

export async function getLeague(leagueId) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}`);
}

export async function getLeagueUsers(leagueId) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/users`);
}

export async function getLeagueRosters(leagueId) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/rosters`);
}

export async function getLeagueMatchups(leagueId, week) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`);
}

export async function getLeagueTransactions(leagueId, week) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/transactions/${week}`);
}

export async function getLeagueDrafts(leagueId) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/drafts`);
}

export async function getDraftPicks(draftId) {
    return fetchJSON(`${SLEEPER_BASE}/draft/${draftId}/picks`);
}

export async function getTradedPicks(leagueId) {
    return fetchJSON(`${SLEEPER_BASE}/league/${leagueId}/traded_picks`);
}

export async function getAllPlayers() {
    return fetchJSON(`${SLEEPER_BASE}/players/nfl`);
}

export async function getWeeklyProjections(season, week) {
    return fetchJSON(
        `${SLEEPER_PROJ}/nfl/${season}/${week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF&order_by=ppr`
    );
}

/**
 * Fetch full league context: league info, rosters, users, NFL state, and players.
 */
export async function getFullLeagueContext(leagueId) {
    const [nflState, league, rosters, users, tradedPicks] = await Promise.all([
        getNflState(),
        getLeague(leagueId),
        getLeagueRosters(leagueId),
        getLeagueUsers(leagueId),
        getTradedPicks(leagueId),
    ]);

    // Build user map
    const userMap = {};
    for (const user of users) {
        userMap[user.user_id] = {
            displayName: user.metadata?.team_name || user.display_name,
            userName: user.user_name || user.display_name,
            avatar: user.avatar,
            userId: user.user_id,
        };
    }

    // Build roster map with owner info
    const rosterMap = {};
    for (const roster of rosters) {
        rosterMap[roster.roster_id] = {
            ...roster,
            ownerName: userMap[roster.owner_id]?.displayName || 'Unknown',
            ownerAvatar: userMap[roster.owner_id]?.avatar || null,
        };
    }

    return {
        nflState,
        league,
        rosters: rosterMap,
        rostersArray: rosters,
        users: userMap,
        tradedPicks,
        scoringSettings: league.scoring_settings,
        rosterPositions: league.roster_positions,
    };
}

/**
 * Fetch recent transactions across all weeks for a league.
 */
export async function getRecentTransactions(leagueId, maxWeek = 18) {
    const promises = [];
    for (let week = 1; week <= maxWeek; week++) {
        promises.push(getLeagueTransactions(leagueId, week).catch(() => []));
    }
    const weeklyTransactions = await Promise.all(promises);
    const all = weeklyTransactions.flat();
    return all.sort((a, b) => b.status_updated - a.status_updated);
}

/**
 * Fetch matchup data for a specific week.
 */
export async function getWeekMatchups(leagueId, week) {
    const matchups = await getLeagueMatchups(leagueId, week);
    const paired = {};
    for (const m of matchups) {
        if (!paired[m.matchup_id]) paired[m.matchup_id] = [];
        paired[m.matchup_id].push(m);
    }
    return paired;
}
