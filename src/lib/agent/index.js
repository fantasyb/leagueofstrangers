/**
 * AI Dynasty Manager - Main Agent Orchestrator
 *
 * Central entry point that coordinates Sleeper API data fetching,
 * player analysis, trade recommendations, roster optimization,
 * and dynasty strategy assessment.
 */

import {
    getFullLeagueContext,
    getAllPlayers,
    getWeeklyProjections,
    getRecentTransactions,
    getNflState,
} from './sleeperClient.js';
import { buildPlayerProfile, rankRosterPlayers, getPositionBreakdown } from './playerAnalysis.js';
import { findTradeTargets, generateTradePackages, analyzeTrade, analyzeNeeds } from './tradeEngine.js';
import { analyzeRoster, optimizeLineup, leaguePowerRankings } from './rosterAnalysis.js';
import { assessStrategy } from './dynastyStrategy.js';

// Cache for expensive API calls (players DB is ~30MB)
let playerCache = null;
let playerCacheTime = 0;
const PLAYER_CACHE_TTL = 3600000; // 1 hour

/**
 * Load the full NFL player database with caching.
 */
async function loadPlayerDatabase() {
    const now = Date.now();
    if (playerCache && (now - playerCacheTime) < PLAYER_CACHE_TTL) {
        return playerCache;
    }
    playerCache = await getAllPlayers();
    playerCacheTime = now;
    return playerCache;
}

/**
 * Run a full agent analysis for a specific roster.
 * This is the primary entry point for the dashboard.
 */
export async function runFullAnalysis(leagueId, myRosterId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const { rosters, scoringSettings, rosterPositions, nflState, league, users, tradedPicks } = context;

    // Build computed player data (merge base player info with scoring context)
    const playerData = buildPlayerData(allPlayers, scoringSettings);

    const myRoster = rosters[myRosterId];
    if (!myRoster) {
        throw new Error(`Roster ${myRosterId} not found in league ${leagueId}`);
    }

    // Run all analyses in parallel
    const [rosterAnalysis, lineup, strategy, powerRankings, trades] = await Promise.all([
        Promise.resolve(analyzeRoster(myRoster, playerData, rosterPositions)),
        Promise.resolve(optimizeLineup(myRoster, playerData, rosterPositions, nflState.week)),
        Promise.resolve(assessStrategy(myRoster, playerData, rosterPositions, { league, nflState })),
        Promise.resolve(leaguePowerRankings(rosters, playerData, rosterPositions)),
        Promise.resolve(generateTradePackages(myRosterId, rosters, playerData, rosterPositions)),
    ]);

    // Find my power ranking
    const myRank = powerRankings.find(r => r.rosterId === parseInt(myRosterId));

    return {
        team: {
            rosterId: myRosterId,
            name: myRoster.ownerName,
            record: myRoster.settings
                ? `${myRoster.settings.wins}-${myRoster.settings.losses}${myRoster.settings.ties > 0 ? `-${myRoster.settings.ties}` : ''}`
                : 'N/A',
            pointsFor: myRoster.settings
                ? (myRoster.settings.fpts + (myRoster.settings.fpts_decimal || 0) / 100).toFixed(2)
                : 'N/A',
            rank: myRank?.rank || 'N/A',
        },
        roster: rosterAnalysis,
        lineup,
        strategy,
        powerRankings,
        trades: trades.slice(0, 10),
        league: {
            name: league.name,
            season: league.season,
            week: nflState.week,
            seasonType: nflState.season_type,
            totalRosters: Object.keys(rosters).length,
        },
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Get trade suggestions for a roster.
 */
export async function getTradeRecommendations(leagueId, myRosterId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const packages = generateTradePackages(myRosterId, context.rosters, playerData, context.rosterPositions);
    const targets = findTradeTargets(myRosterId, context.rosters, playerData, context.rosterPositions);

    return {
        packages: packages.slice(0, 15),
        targets: targets.slice(0, 20),
        myNeeds: analyzeNeeds(
            context.rosterPositions,
            rankRosterPlayers(context.rosters[myRosterId], playerData)
        ),
    };
}

/**
 * Get a specific player profile with dynasty context.
 */
export async function getPlayerProfile(leagueId, playerId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    return buildPlayerProfile(playerId, playerData);
}

/**
 * Search for players by name.
 */
export async function searchPlayers(query, limit = 20) {
    const allPlayers = await loadPlayerDatabase();
    const results = [];
    const queryLower = query.toLowerCase();

    for (const id in allPlayers) {
        const p = allPlayers[id];
        if (!p.first_name || !p.last_name) continue;
        const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
        if (fullName.includes(queryLower)) {
            results.push({
                id,
                name: `${p.first_name} ${p.last_name}`,
                position: p.position,
                team: p.team || 'FA',
            });
        }
        if (results.length >= limit) break;
    }

    return results;
}

/**
 * Get optimized lineup for a specific week.
 */
export async function getOptimalLineup(leagueId, myRosterId, week = null) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const myRoster = context.rosters[myRosterId];
    const targetWeek = week || context.nflState.week;

    return optimizeLineup(myRoster, playerData, context.rosterPositions, targetWeek);
}

/**
 * Get dynasty strategy assessment.
 */
export async function getStrategyAssessment(leagueId, myRosterId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    return assessStrategy(
        context.rosters[myRosterId],
        playerData,
        context.rosterPositions,
        { league: context.league, nflState: context.nflState }
    );
}

/**
 * Evaluate a hypothetical trade.
 */
export async function evaluateTrade(leagueId, sendIds, receiveIds) {
    const allPlayers = await loadPlayerDatabase();
    const context = await getFullLeagueContext(leagueId);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);

    return analyzeTrade(sendIds, receiveIds, playerData);
}

/**
 * Get league-wide power rankings.
 */
export async function getPowerRankings(leagueId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    return leaguePowerRankings(context.rosters, playerData, context.rosterPositions);
}

/**
 * Build computed player data from raw Sleeper player DB.
 * Merges base player info with a simplified format for analysis.
 */
function buildPlayerData(allPlayers, scoringSettings) {
    const computed = {};

    for (const id in allPlayers) {
        const p = allPlayers[id];
        if (!p.first_name || !p.last_name) continue;

        computed[id] = {
            fn: p.first_name,
            ln: p.last_name,
            pos: p.position,
            t: p.team || null,
            is: p.injury_status || null,
            age: p.age || null,
            years_exp: p.years_exp,
            birth_date: p.birth_date,
            wi: {}, // Weekly info placeholder
            number: p.number,
            college: p.college,
            status: p.status,
            depth_chart_order: p.depth_chart_order,
        };
    }

    return computed;
}

/**
 * List all rosters in the league with basic info.
 */
export async function listLeagueRosters(leagueId) {
    const context = await getFullLeagueContext(leagueId);
    const rosterList = [];

    for (const rosterId in context.rosters) {
        const r = context.rosters[rosterId];
        rosterList.push({
            rosterId: parseInt(rosterId),
            ownerName: r.ownerName,
            ownerId: r.owner_id,
            playerCount: r.players?.length || 0,
            record: r.settings
                ? `${r.settings.wins}-${r.settings.losses}`
                : 'N/A',
        });
    }

    return rosterList.sort((a, b) => a.rosterId - b.rosterId);
}
