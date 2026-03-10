/**
 * AI Dynasty Manager - Main Agent Orchestrator (Enhanced)
 *
 * Coordinates Sleeper API data, ESPN stats, draft/combine data,
 * player analysis, trade recommendations, waiver intelligence,
 * roster optimization, and dynasty strategy assessment.
 */

import {
    getFullLeagueContext,
    getAllPlayers,
    getWeeklyProjections,
    getRecentTransactions,
    getNflState,
    getPlayerStats,
    getPlayerStatsTwoSeasons,
    detectLeagueSettings,
} from './sleeperClient.js';
import {
    buildPlayerProfile,
    rankRosterPlayers,
    getPositionBreakdown,
    setLeagueContext,
    calculateTrendFactor,
} from './playerAnalysis.js';
import { findTradeTargets, generateTradePackages, analyzeTrade, analyzeNeeds, matchTradePartnersByStrategy } from './tradeEngine.js';
import { analyzeRoster, optimizeLineup, leaguePowerRankings } from './rosterAnalysis.js';
import { assessStrategy } from './dynastyStrategy.js';
import { runWaiverAnalysis } from './waiverAnalysis.js';
import { getSeasonLeaders } from './espnClient.js';

// Cache for expensive API calls
let playerCache = null;
let playerCacheTime = 0;
const PLAYER_CACHE_TTL = 3600000; // 1 hour

let enrichmentCache = null;
let enrichmentCacheTime = 0;
const ENRICHMENT_CACHE_TTL = 3600000;

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
 * Build enrichment data: production trends, NFL stats, etc.
 * This data supplements the basic Sleeper player info.
 */
async function buildEnrichmentData(season) {
    const now = Date.now();
    if (enrichmentCache && (now - enrichmentCacheTime) < ENRICHMENT_CACHE_TTL) {
        return enrichmentCache;
    }

    const enrichment = {};

    try {
        // Fetch Sleeper season stats for trend analysis
        const { current, previous } = await getPlayerStatsTwoSeasons(season);

        if (current) {
            for (const pid in current) {
                const curr = current[pid];
                const prev = previous?.[pid];

                enrichment[pid] = {
                    trendFactor: calculateTrendFactor(curr, prev),
                    seasonStats: curr,
                    previousSeasonStats: prev || null,
                };
            }
        }

        // Try to fetch ESPN season leaders for additional context
        try {
            const espnStats = await getSeasonLeaders(season);
            if (espnStats) {
                for (const pid in enrichment) {
                    const player = enrichment[pid];
                    if (!player.seasonStats) continue;

                    // Try to match by name (ESPN uses display names)
                    const firstName = player.seasonStats?.first_name || '';
                    const lastName = player.seasonStats?.last_name || '';
                    if (firstName && lastName) {
                        const key = `${firstName} ${lastName}`.toLowerCase();
                        if (espnStats[key]) {
                            enrichment[pid].nflStats = espnStats[key].stats;
                        }
                    }
                }
            }
        } catch {
            // ESPN data is supplemental, don't fail if unavailable
        }
    } catch {
        // Enrichment is optional, return empty if API fails
    }

    enrichmentCache = enrichment;
    enrichmentCacheTime = now;
    return enrichment;
}

/**
 * Configure league context for value calculations.
 */
function configureLeagueContext(context) {
    const settings = detectLeagueSettings(
        context.rosterPositions,
        context.scoringSettings
    );
    setLeagueContext(settings);
    return settings;
}

/**
 * Run a full agent analysis for a specific roster.
 */
export async function runFullAnalysis(leagueId, myRosterId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    const { rosters, scoringSettings, rosterPositions, nflState, league, users, tradedPicks } = context;

    // Configure league format (Superflex, TEP, etc.)
    const leagueSettings = configureLeagueContext(context);

    // Build computed player data
    const playerData = buildPlayerData(allPlayers, scoringSettings);

    // Build enrichment data (trends, ESPN stats)
    const enrichment = await buildEnrichmentData(league.season).catch(() => ({}));

    const myRoster = rosters[myRosterId];
    if (!myRoster) {
        throw new Error(`Roster ${myRosterId} not found in league ${leagueId}`);
    }

    // Run all analyses in parallel
    const [rosterAnalysis, lineup, strategy, powerRankings, trades, waivers] = await Promise.all([
        Promise.resolve(analyzeRoster(myRoster, playerData, rosterPositions, enrichment)),
        Promise.resolve(optimizeLineup(myRoster, playerData, rosterPositions, nflState.week)),
        Promise.resolve(assessStrategy(myRoster, playerData, rosterPositions, { league, nflState }, enrichment)),
        Promise.resolve(leaguePowerRankings(rosters, playerData, rosterPositions, enrichment)),
        Promise.resolve(generateTradePackages(myRosterId, rosters, playerData, rosterPositions, enrichment, tradedPicks)),
        Promise.resolve(runWaiverAnalysis(rosters, playerData, rosterPositions, myRosterId, enrichment)),
    ]);

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
        trades: trades.slice(0, 15),
        waivers,
        league: {
            name: league.name,
            season: league.season,
            week: nflState.week,
            seasonType: nflState.season_type,
            totalRosters: Object.keys(rosters).length,
            format: leagueSettings,
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

    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    const packages = generateTradePackages(myRosterId, context.rosters, playerData, context.rosterPositions, enrichment, context.tradedPicks);
    const targets = findTradeTargets(myRosterId, context.rosters, playerData, context.rosterPositions, enrichment);
    const partners = matchTradePartnersByStrategy(myRosterId, context.rosters, playerData, context.rosterPositions);

    return {
        packages: packages.slice(0, 20),
        targets: targets.slice(0, 25),
        partners,
        myNeeds: analyzeNeeds(
            context.rosterPositions,
            rankRosterPlayers(context.rosters[myRosterId], playerData, enrichment)
        ),
    };
}

/**
 * Get waiver wire analysis for a roster.
 */
export async function getWaiverAnalysis(leagueId, myRosterId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    return runWaiverAnalysis(context.rosters, playerData, context.rosterPositions, myRosterId, enrichment);
}

/**
 * Get a specific player profile with dynasty context.
 */
export async function getPlayerProfile(leagueId, playerId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    return buildPlayerProfile(playerId, playerData, enrichment);
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
                age: p.age,
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

    configureLeagueContext(context);
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

    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    return assessStrategy(
        context.rosters[myRosterId],
        playerData,
        context.rosterPositions,
        { league: context.league, nflState: context.nflState },
        enrichment
    );
}

/**
 * Evaluate a hypothetical trade.
 */
export async function evaluateTrade(leagueId, sendIds, receiveIds) {
    const allPlayers = await loadPlayerDatabase();
    const context = await getFullLeagueContext(leagueId);
    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    return analyzeTrade(sendIds, receiveIds, playerData, enrichment);
}

/**
 * Get league-wide power rankings.
 */
export async function getPowerRankings(leagueId) {
    const [context, allPlayers] = await Promise.all([
        getFullLeagueContext(leagueId),
        loadPlayerDatabase(),
    ]);

    configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season).catch(() => ({}));

    return leaguePowerRankings(context.rosters, playerData, context.rosterPositions, enrichment);
}

/**
 * Build computed player data from raw Sleeper player DB.
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
            wi: {},
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
