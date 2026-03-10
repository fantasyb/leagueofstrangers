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
import { getKTCValues } from './ktcClient.js';
import { getFantasyCalcValues, getFantasyCalcBySleeperIds } from './fantasyCalcClient.js';

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
 * Build enrichment data: production trends, NFL stats, market consensus values.
 * This data supplements the basic Sleeper player info with external sources:
 *   - Sleeper season stats → trend analysis
 *   - ESPN stats → real NFL production
 *   - KeepTradeCut → dynasty market consensus values
 *   - FantasyCalc → crowd-sourced trade values from actual dynasty trades
 */
async function buildEnrichmentData(season, playerData = null, leagueSettings = {}) {
    const now = Date.now();
    if (enrichmentCache && (now - enrichmentCacheTime) < ENRICHMENT_CACHE_TTL) {
        return enrichmentCache;
    }

    const enrichment = {};

    try {
        // Phase 1: Fetch all data sources in parallel
        const [sleeperStats, espnStats, ktcValues, fcValues] = await Promise.all([
            getPlayerStatsTwoSeasons(season).catch(() => ({ current: null, previous: null })),
            getSeasonLeaders(season).catch(() => null),
            getKTCValues().catch(() => null),
            getFantasyCalcValues({
                isDynasty: true,
                numQbs: leagueSettings.superflex ? 2 : 1,
                ppr: leagueSettings.ppr ? 1 : leagueSettings.halfPpr ? 0.5 : 1,
                numTeams: 12,
            }).catch(() => null),
        ]);

        // Phase 2: Build base enrichment from Sleeper stats
        const { current, previous } = sleeperStats;
        if (current) {
            for (const pid in current) {
                const curr = current[pid];
                const prev = previous?.[pid];

                enrichment[pid] = {
                    trendFactor: calculateTrendFactor(curr, prev),
                    seasonStats: curr,
                    previousSeasonStats: prev || null,
                    nflStats: null,
                    ktcValue: null,
                    ktcSuperflexValue: null,
                    ktcTrend: null,
                    ktcRank: null,
                    fcValue: null,
                    fcRank: null,
                    marketConsensus: null,
                };
            }
        }

        // Phase 3: Layer in ESPN stats
        if (espnStats) {
            for (const pid in enrichment) {
                const player = enrichment[pid];
                if (!player.seasonStats) continue;

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

        // Phase 4: Layer in KTC dynasty consensus values
        if (ktcValues) {
            // Match KTC values to Sleeper player IDs by name
            for (const pid in playerData || {}) {
                const p = playerData[pid];
                if (!p?.fn || !p?.ln) continue;

                const name = `${p.fn} ${p.ln}`.toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
                const ktc = ktcValues[name]
                    || ktcValues[name.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')]
                    || null;

                if (ktc) {
                    if (!enrichment[pid]) {
                        enrichment[pid] = {
                            trendFactor: 1.0,
                            seasonStats: null,
                            previousSeasonStats: null,
                            nflStats: null,
                            ktcValue: null,
                            ktcSuperflexValue: null,
                            ktcTrend: null,
                            ktcRank: null,
                            fcValue: null,
                            fcRank: null,
                            marketConsensus: null,
                        };
                    }
                    enrichment[pid].ktcValue = ktc.value;
                    enrichment[pid].ktcSuperflexValue = ktc.superflexValue;
                    enrichment[pid].ktcTrend = {
                        day7: ktc.trend7Day,
                        day30: ktc.trend30Day,
                    };
                    enrichment[pid].ktcRank = ktc.rank;
                }
            }
        }

        // Phase 5: Layer in FantasyCalc values
        if (fcValues) {
            for (const pid in playerData || {}) {
                const p = playerData[pid];
                if (!p?.fn || !p?.ln) continue;

                const name = `${p.fn} ${p.ln}`.toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();
                const fc = fcValues[name]
                    || fcValues[name.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')]
                    || null;

                if (fc) {
                    if (!enrichment[pid]) {
                        enrichment[pid] = {
                            trendFactor: 1.0,
                            seasonStats: null,
                            previousSeasonStats: null,
                            nflStats: null,
                            ktcValue: null,
                            ktcSuperflexValue: null,
                            ktcTrend: null,
                            ktcRank: null,
                            fcValue: null,
                            fcRank: null,
                            marketConsensus: null,
                        };
                    }
                    enrichment[pid].fcValue = fc.value;
                    enrichment[pid].fcRank = fc.overallRank;
                }
            }
        }

        // Phase 6: Compute blended market consensus
        for (const pid in enrichment) {
            const e = enrichment[pid];
            const ktcVal = leagueSettings.superflex ? e.ktcSuperflexValue : e.ktcValue;
            const fcVal = e.fcValue;

            if (ktcVal || fcVal) {
                // Normalize both to 0-10000 scale
                // KTC is already roughly 0-9999
                // FantasyCalc uses a different scale, normalize proportionally
                const ktcNorm = ktcVal ? Math.min(10000, ktcVal) : null;
                const fcNorm = fcVal ? normalizeFantasyCalcValue(fcVal) : null;

                let consensus;
                if (ktcNorm && fcNorm) {
                    // Weighted blend: KTC 60%, FantasyCalc 40% (KTC is more established)
                    consensus = Math.round(ktcNorm * 0.6 + fcNorm * 0.4);
                } else {
                    consensus = ktcNorm || fcNorm;
                }

                enrichment[pid].marketConsensus = {
                    value: consensus,
                    ktcValue: ktcNorm,
                    fcValue: fcNorm,
                    sources: [ktcNorm ? 'KTC' : null, fcNorm ? 'FantasyCalc' : null].filter(Boolean),
                };
            }
        }
    } catch {
        // Enrichment is optional, return empty if API fails
    }

    enrichmentCache = enrichment;
    enrichmentCacheTime = now;
    return enrichment;
}

/**
 * Normalize FantasyCalc values to our 0-10000 scale.
 * FC values max around 10000-12000 for top players.
 */
function normalizeFantasyCalcValue(fcValue) {
    // FC dynasty values roughly align with KTC but can go higher for top guys
    // Cap at 10000 to match our scale
    return Math.min(10000, Math.max(0, Math.round(fcValue)));
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

    // Build enrichment data (trends, ESPN stats, KTC, FantasyCalc)
    const enrichment = await buildEnrichmentData(league.season, playerData, leagueSettings).catch(() => ({}));

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

    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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

    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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

    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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

    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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
    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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

    const leagueSettings = configureLeagueContext(context);
    const playerData = buildPlayerData(allPlayers, context.scoringSettings);
    const enrichment = await buildEnrichmentData(context.league.season, playerData, leagueSettings).catch(() => ({}));

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
