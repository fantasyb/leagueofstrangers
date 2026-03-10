/**
 * Player Analysis & Dynasty Value System
 *
 * Calculates dynasty trade values based on position, age, production,
 * league format (Superflex, TE Premium), draft capital, athleticism,
 * and production trends. Uses a 0-10000 point scale (KTC-style).
 */

import { getDraftCapitalFactor, getAthleticFactor, getScoutingProfile } from './nflDataClient.js';

// Default position prime age ranges and decline curves
const POSITION_AGE_CURVES = {
    QB: { peakStart: 25, peakEnd: 33, declineRate: 0.06, longevity: 40, baseValue: 8000 },
    RB: { peakStart: 22, peakEnd: 27, declineRate: 0.15, longevity: 32, baseValue: 6500 },
    WR: { peakStart: 23, peakEnd: 30, declineRate: 0.08, longevity: 35, baseValue: 7500 },
    TE: { peakStart: 24, peakEnd: 31, declineRate: 0.07, longevity: 36, baseValue: 5500 },
    K:  { peakStart: 25, peakEnd: 36, declineRate: 0.03, longevity: 42, baseValue: 1000 },
    DEF:{ peakStart: 0,  peakEnd: 99, declineRate: 0.00, longevity: 99, baseValue: 1500 },
};

// Superflex adjustments — QBs become the most valuable asset
const SUPERFLEX_ADJUSTMENTS = {
    QB: { baseValue: 10500 },
};

// TE Premium adjustments — TEs get a significant boost
const TEP_ADJUSTMENTS = {
    TE: { baseValue: 7500 },
};

// Scoring tier multipliers - applied to base value
const TIER_MULTIPLIERS = {
    elite:     1.25,  // Top 3 at position
    starter:   1.00,  // Top 12 QB, Top 24 RB/WR, Top 12 TE
    flex:      0.70,  // Startable but not locked in
    bench:     0.40,  // Depth piece
    roster:    0.15,  // Roster stash / handcuff
};

// League settings context (set by setLeagueContext)
let leagueCtx = { superflex: false, tePremium: false, halfPpr: false, ppr: true };

/**
 * Set the league format context for all value calculations.
 */
export function setLeagueContext(settings) {
    leagueCtx = { ...leagueCtx, ...settings };
}

/**
 * Get the position curve adjusted for league format.
 */
function getAdjustedCurve(pos) {
    const base = { ...POSITION_AGE_CURVES[pos] };
    if (!base) return null;

    if (leagueCtx.superflex && SUPERFLEX_ADJUSTMENTS[pos]) {
        base.baseValue = SUPERFLEX_ADJUSTMENTS[pos].baseValue;
    }
    if (leagueCtx.tePremium && TEP_ADJUSTMENTS[pos]) {
        base.baseValue = TEP_ADJUSTMENTS[pos].baseValue;
    }
    return base;
}

/**
 * Calculate a player's dynasty value score (0-10000).
 * Now considers league format, draft capital, athleticism, and trends.
 */
export function calculateDynastyValue(player, stats = {}, enrichment = {}) {
    const pos = player.pos || player.position;
    const curve = getAdjustedCurve(pos);
    if (!curve) return 0;

    const age = player.age || estimateAge(player);
    const baseTier = classifyTier(player, stats);
    const tierMult = TIER_MULTIPLIERS[baseTier] || TIER_MULTIPLIERS.bench;

    // Age factor: 1.0 during prime, declining after
    let ageFactor = 1.0;
    if (age < curve.peakStart) {
        const yearsToGo = curve.peakStart - age;
        ageFactor = 0.85 + (yearsToGo * 0.04);
    } else if (age > curve.peakEnd) {
        const yearsOver = age - curve.peakEnd;
        ageFactor = Math.max(0.1, 1.0 - (yearsOver * curve.declineRate));
    }

    // Production factor based on fantasy points
    const productionFactor = calculateProductionFactor(player, stats, pos);

    // Calculate raw value
    let value = curve.baseValue * tierMult * ageFactor * productionFactor;

    // Youth premium for players under 25
    if (age <= 24 && (pos === 'WR' || pos === 'RB' || pos === 'QB' || pos === 'TE')) {
        value *= 1.1;
    }

    // === NEW VALUE FACTORS ===

    // Draft capital factor (matters more for young players)
    const playerName = `${player.fn} ${player.ln}`;
    const draftFactor = getDraftCapitalFactor(playerName, player.years_exp);
    value *= draftFactor;

    // Athletic profile factor (±5% for skill positions)
    if (['RB', 'WR', 'TE'].includes(pos)) {
        const athleticFactor = getAthleticFactor(playerName, pos);
        value *= athleticFactor;
    }

    // Production trend factor
    if (enrichment.trendFactor) {
        value *= enrichment.trendFactor;
    }

    // Injury discount
    if (player.is) {
        const injuryDiscount = getInjuryDiscount(player.is);
        value *= injuryDiscount;
    }

    // Market consensus calibration (KTC + FantasyCalc blend)
    // If external market data is available, blend it in:
    //   - 80% internal model, 20% market consensus
    //   - This anchors extreme outliers without letting the market override the model
    const marketConsensus = enrichment.marketConsensus?.value;
    if (marketConsensus && marketConsensus > 0) {
        value = value * 0.80 + marketConsensus * 0.20;
    }

    return Math.round(Math.min(10000, Math.max(0, value)));
}

/**
 * Estimate age from years_exp if birth_date not available.
 */
function estimateAge(player) {
    if (player.birth_date) {
        const birth = new Date(player.birth_date);
        const now = new Date();
        return Math.floor((now - birth) / (365.25 * 24 * 60 * 60 * 1000));
    }
    if (player.years_exp !== undefined && player.years_exp !== null) {
        return 22 + player.years_exp;
    }
    return 26;
}

/**
 * Classify player into a production tier.
 * Adjusts thresholds for Superflex (QBs become more valuable as starters).
 */
function classifyTier(player, stats) {
    const weeklyPts = stats.avgPointsPerWeek || 0;
    const pos = player.pos || player.position;

    if (pos === 'QB') {
        // In Superflex, QB thresholds shift — more QBs are "startable"
        if (leagueCtx.superflex) {
            if (weeklyPts >= 22) return 'elite';
            if (weeklyPts >= 15) return 'starter';
            if (weeklyPts >= 10) return 'flex';     // SF flex = starting a QB2
            if (weeklyPts >= 5) return 'bench';
            return 'roster';
        }
        if (weeklyPts >= 22) return 'elite';
        if (weeklyPts >= 16) return 'starter';
        if (weeklyPts >= 12) return 'flex';
        if (weeklyPts >= 6) return 'bench';
        return 'roster';
    }
    if (pos === 'RB') {
        if (weeklyPts >= 18) return 'elite';
        if (weeklyPts >= 12) return 'starter';
        if (weeklyPts >= 8) return 'flex';
        if (weeklyPts >= 4) return 'bench';
        return 'roster';
    }
    if (pos === 'WR') {
        if (weeklyPts >= 18) return 'elite';
        if (weeklyPts >= 13) return 'starter';
        if (weeklyPts >= 9) return 'flex';
        if (weeklyPts >= 5) return 'bench';
        return 'roster';
    }
    if (pos === 'TE') {
        // In TE Premium, TE thresholds go up (more TEs score well)
        if (leagueCtx.tePremium) {
            if (weeklyPts >= 16) return 'elite';
            if (weeklyPts >= 11) return 'starter';
            if (weeklyPts >= 8) return 'flex';
            if (weeklyPts >= 4) return 'bench';
            return 'roster';
        }
        if (weeklyPts >= 14) return 'elite';
        if (weeklyPts >= 10) return 'starter';
        if (weeklyPts >= 7) return 'flex';
        if (weeklyPts >= 3) return 'bench';
        return 'roster';
    }
    return 'roster';
}

/**
 * Calculate production factor from weekly scoring data.
 */
function calculateProductionFactor(player, stats, pos) {
    if (!stats.avgPointsPerWeek && !stats.totalPoints) return 0.7;

    const avg = stats.avgPointsPerWeek || 0;
    const benchmarks = { QB: 20, RB: 15, WR: 15, TE: 10, K: 8, DEF: 7 };
    const benchmark = benchmarks[pos] || 10;

    return Math.max(0.3, Math.min(1.5, 0.5 + (avg / benchmark) * 0.5));
}

/**
 * Calculate internal model value (without market consensus blend).
 * Used for divergence detection in market signals.
 */
function calculateInternalValue(player, stats, enrichment) {
    const pos = player.pos || player.position;
    const curve = getAdjustedCurve(pos);
    if (!curve) return 0;

    const age = player.age || estimateAge(player);
    const baseTier = classifyTier(player, stats);
    const tierMult = TIER_MULTIPLIERS[baseTier] || TIER_MULTIPLIERS.bench;

    let ageFactor = 1.0;
    if (age < curve.peakStart) {
        ageFactor = 0.85 + ((curve.peakStart - age) * 0.04);
    } else if (age > curve.peakEnd) {
        ageFactor = Math.max(0.1, 1.0 - ((age - curve.peakEnd) * curve.declineRate));
    }

    const productionFactor = calculateProductionFactor(player, stats, pos);
    let value = curve.baseValue * tierMult * ageFactor * productionFactor;

    if (age <= 24) value *= 1.1;

    const playerName = `${player.fn} ${player.ln}`;
    value *= getDraftCapitalFactor(playerName, player.years_exp);
    if (['RB', 'WR', 'TE'].includes(pos)) {
        value *= getAthleticFactor(playerName, pos);
    }
    if (enrichment.trendFactor) value *= enrichment.trendFactor;
    if (player.is) value *= getInjuryDiscount(player.is);

    return Math.round(Math.min(10000, Math.max(0, value)));
}

/**
 * Apply injury-based discount to value.
 */
function getInjuryDiscount(injuryStatus) {
    const discounts = {
        'Out': 0.85, 'Doubtful': 0.90, 'Questionable': 0.95,
        'IR': 0.70, 'PUP': 0.75, 'Sus': 0.60, 'COV': 0.90,
    };
    return discounts[injuryStatus] || 0.95;
}

/**
 * Calculate production trend factor.
 * Compares current season stats to previous season.
 * Returns a multiplier: >1.0 = improving, <1.0 = declining.
 */
export function calculateTrendFactor(currentStats, previousStats) {
    if (!currentStats || !previousStats) return 1.0;

    const currPpg = currentStats.pts_ppr_per_game || currentStats.avgPointsPerWeek || 0;
    const prevPpg = previousStats.pts_ppr_per_game || previousStats.avgPointsPerWeek || 0;

    if (prevPpg === 0) return 1.0;

    const changePercent = (currPpg - prevPpg) / prevPpg;

    // Cap the trend factor between 0.85 and 1.15
    if (changePercent > 0.15) return 1.12;
    if (changePercent > 0.05) return 1.0 + changePercent * 0.8;
    if (changePercent < -0.15) return 0.88;
    if (changePercent < -0.05) return 1.0 + changePercent * 0.8;
    return 1.0;
}

/**
 * Classify a player's market signal: Sell High, Buy Low, Hold, or Neutral.
 */
export function classifyMarketSignal(player, stats = {}, enrichment = {}) {
    const pos = player.pos || player.position;
    const age = player.age || estimateAge(player);
    const tier = classifyTier(player, stats);
    const trendFactor = enrichment.trendFactor || 1.0;
    const playerName = `${player.fn} ${player.ln}`;
    const draftCapitalFactor = getDraftCapitalFactor(playerName, player.years_exp);

    let signal = 'Hold';
    let reasons = [];

    // SELL HIGH signals
    if (tier === 'elite' && age >= 28 && pos === 'RB') {
        signal = 'Sell High';
        reasons.push('Elite RB production but approaching cliff age');
    } else if (tier === 'elite' && age >= 31 && (pos === 'WR' || pos === 'TE')) {
        signal = 'Sell High';
        reasons.push(`Elite production but ${age} years old — value will decline`);
    } else if (trendFactor > 1.10 && age >= 27) {
        signal = 'Sell High';
        reasons.push('Trending up but aging — peak value moment');
    } else if (tier === 'starter' && trendFactor < 0.92 && age >= 28) {
        signal = 'Sell High';
        reasons.push('Declining production + aging — sell before value drops further');
    }

    // BUY LOW signals
    if (signal === 'Hold') {
        if (age <= 24 && draftCapitalFactor > 1.10 && (tier === 'bench' || tier === 'flex')) {
            signal = 'Buy Low';
            reasons.push('Young with high draft capital — hasn\'t broken out yet');
        } else if (trendFactor < 0.90 && age <= 26 && tier !== 'roster') {
            signal = 'Buy Low';
            reasons.push('Down year but young — buy the dip');
        } else if (player.is === 'IR' && age <= 27 && tier !== 'roster') {
            signal = 'Buy Low';
            reasons.push('Injured but young — depressed value, buy for recovery');
        }
    }

    // Market consensus divergence signals
    // If our internal model and the market disagree significantly, flag it
    const marketConsensus = enrichment.marketConsensus;
    if (marketConsensus?.value) {
        const internalValue = calculateInternalValue(player, stats, enrichment);
        const divergence = (marketConsensus.value - internalValue) / Math.max(internalValue, 1);

        if (divergence > 0.25 && signal === 'Hold') {
            // Market values them much higher than our model
            signal = 'Sell High';
            reasons.push(`Market overvalues vs production (KTC/FC: ${marketConsensus.value.toLocaleString()} vs model: ${internalValue.toLocaleString()})`);
        } else if (divergence < -0.25 && signal === 'Hold') {
            // Market values them much lower than our model
            signal = 'Buy Low';
            reasons.push(`Market undervalues vs production (KTC/FC: ${marketConsensus.value.toLocaleString()} vs model: ${internalValue.toLocaleString()})`);
        } else if (divergence > 0.15 && signal !== 'Buy Low') {
            reasons.push(`Market premium: +${Math.round(divergence * 100)}% above model value`);
        } else if (divergence < -0.15 && signal !== 'Sell High') {
            reasons.push(`Market discount: ${Math.round(divergence * 100)}% below model value`);
        }
    }

    // KTC trend signals
    const ktcTrend = enrichment.ktcTrend;
    if (ktcTrend) {
        if (ktcTrend.day30 > 500) {
            reasons.push(`KTC trending up +${ktcTrend.day30} over 30 days`);
        } else if (ktcTrend.day30 < -500) {
            reasons.push(`KTC trending down ${ktcTrend.day30} over 30 days`);
        }
    }

    return { signal, reasons, trendFactor };
}

/**
 * Build a full player profile with dynasty analysis.
 * Now includes scouting profile, market signals, and enriched stats.
 */
export function buildPlayerProfile(playerId, playerData, enrichment = {}) {
    const player = playerData[playerId];
    if (!player) return null;

    const pos = player.pos || player.position;
    const age = estimateAge({ ...player, years_exp: player.years_exp });
    const curve = getAdjustedCurve(pos) || POSITION_AGE_CURVES['WR'];
    const playerName = `${player.fn} ${player.ln}`;

    // Calculate projected weekly pts from player data
    const weeklyProjections = [];
    if (player.wi) {
        for (const week in player.wi) {
            if (player.wi[week]?.p) {
                weeklyProjections.push(player.wi[week].p);
            }
        }
    }

    const avgProjection = weeklyProjections.length > 0
        ? weeklyProjections.reduce((a, b) => a + b, 0) / weeklyProjections.length
        : 0;

    const playerEnrichment = enrichment[playerId] || {};
    const stats = { avgPointsPerWeek: avgProjection, totalPoints: avgProjection * 17 };
    const dynastyValue = calculateDynastyValue({ ...player, age }, stats, playerEnrichment);
    const tier = classifyTier({ ...player, age }, stats);

    // Championship window
    const yearsInPrime = age < curve.peakEnd ? curve.peakEnd - age : 0;
    const windowStatus = yearsInPrime > 4 ? 'Long Window' :
                         yearsInPrime > 2 ? 'Prime Window' :
                         yearsInPrime > 0 ? 'Closing Window' : 'Past Prime';

    // Scouting profile (draft capital + combine)
    const scouting = getScoutingProfile(playerName, pos);

    // Market signal
    const marketSignal = classifyMarketSignal(
        { ...player, age }, stats, playerEnrichment
    );

    // NFL stats from enrichment
    const nflStats = playerEnrichment.nflStats || null;

    // Market consensus data
    const marketConsensus = playerEnrichment.marketConsensus || null;
    const ktcTrend = playerEnrichment.ktcTrend || null;
    const ktcRank = playerEnrichment.ktcRank || null;

    // Calculate value comparison vs market
    let marketComparison = null;
    if (marketConsensus?.value) {
        const internalVal = calculateInternalValue({ ...player, age }, stats, playerEnrichment);
        const diff = dynastyValue - marketConsensus.value;
        const pctDiff = Math.round((diff / Math.max(marketConsensus.value, 1)) * 100);
        marketComparison = {
            internalValue: internalVal,
            consensusValue: marketConsensus.value,
            ktcValue: marketConsensus.ktcValue,
            fcValue: marketConsensus.fcValue,
            sources: marketConsensus.sources,
            difference: diff,
            percentDifference: pctDiff,
            assessment: pctDiff > 15 ? 'Overvalued by Market' :
                       pctDiff < -15 ? 'Undervalued by Market' :
                       'Fair Market Value',
        };
    }

    return {
        id: playerId,
        name: playerName,
        firstName: player.fn,
        lastName: player.ln,
        position: pos,
        team: player.t || 'FA',
        age,
        injuryStatus: player.is || null,
        dynastyValue,
        tier,
        windowStatus,
        yearsInPrime,
        avgProjection: Math.round(avgProjection * 100) / 100,
        weeklyProjections,
        outlook: generateOutlook(pos, age, tier, windowStatus, avgProjection, marketSignal),
        scouting,
        marketSignal,
        marketConsensus: marketComparison,
        ktcTrend,
        ktcRank,
        nflStats,
        depthChartOrder: player.depth_chart_order,
        college: player.college,
        yearsExp: player.years_exp,
        number: player.number,
    };
}

/**
 * Generate a text outlook for a player.
 */
function generateOutlook(pos, age, tier, windowStatus, avgPts, marketSignal) {
    const tierLabels = {
        elite: 'Elite', starter: 'Solid Starter', flex: 'Flex Option',
        bench: 'Bench Depth', roster: 'Roster Stash',
    };

    let outlook = `${tierLabels[tier] || 'Unknown'} ${pos}`;

    if (windowStatus === 'Long Window') {
        outlook += ` with significant long-term upside. At ${age}, has many productive years ahead.`;
    } else if (windowStatus === 'Prime Window') {
        outlook += ` currently in prime production years. Maximize value now.`;
    } else if (windowStatus === 'Closing Window') {
        outlook += ` with a closing window. Consider selling high if rebuilding.`;
    } else {
        outlook += ` past traditional prime. Sell candidate in dynasty formats.`;
    }

    if (avgPts > 0) {
        outlook += ` Projected for ~${avgPts.toFixed(1)} PPG.`;
    }

    if (marketSignal?.signal !== 'Hold' && marketSignal?.signal !== 'Neutral') {
        outlook += ` **${marketSignal.signal}**: ${marketSignal.reasons[0] || ''}`;
    }

    return outlook;
}

/**
 * Rank all players on a roster by dynasty value.
 */
export function rankRosterPlayers(roster, playerData, enrichment = {}) {
    const profiles = [];
    const allPlayerIds = [...(roster.players || [])];

    for (const pid of allPlayerIds) {
        const profile = buildPlayerProfile(pid, playerData, enrichment);
        if (profile) {
            profiles.push(profile);
        }
    }

    return profiles.sort((a, b) => b.dynastyValue - a.dynastyValue);
}

/**
 * Get position group breakdown for a roster.
 */
export function getPositionBreakdown(rankedPlayers) {
    const groups = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };

    for (const p of rankedPlayers) {
        if (groups[p.position]) {
            groups[p.position].push(p);
        }
    }

    const breakdown = {};
    for (const pos in groups) {
        const players = groups[pos];
        const totalValue = players.reduce((sum, p) => sum + p.dynastyValue, 0);
        const avgAge = players.length > 0
            ? players.reduce((sum, p) => sum + p.age, 0) / players.length
            : 0;

        breakdown[pos] = {
            players,
            count: players.length,
            totalValue,
            avgAge: Math.round(avgAge * 10) / 10,
            grade: gradePositionGroup(pos, players),
        };
    }

    return breakdown;
}

/**
 * Grade a position group (A+ through F).
 * Thresholds adjusted for Superflex (QB worth more) and TEP.
 */
function gradePositionGroup(pos, players) {
    const totalValue = players.reduce((sum, p) => sum + p.dynastyValue, 0);

    const thresholds = {
        QB: leagueCtx.superflex
            ? { 'A+': 16000, A: 12000, B: 8500, C: 5500, D: 3000 }
            : { 'A+': 12000, A: 9000, B: 6500, C: 4000, D: 2000 },
        RB: { 'A+': 18000, A: 13000, B: 9000, C: 5000, D: 2500 },
        WR: { 'A+': 22000, A: 16000, B: 11000, C: 6000, D: 3000 },
        TE: leagueCtx.tePremium
            ? { 'A+': 12000, A: 9000, B: 6000, C: 3500, D: 1800 }
            : { 'A+': 8000, A: 6000, B: 4000, C: 2500, D: 1200 },
        K:  { 'A+': 2000, A: 1500, B: 1000, C: 500, D: 200 },
        DEF:{ 'A+': 3000, A: 2000, B: 1500, C: 1000, D: 500 },
    };

    const t = thresholds[pos] || thresholds['WR'];
    if (totalValue >= t['A+']) return 'A+';
    if (totalValue >= t.A) return 'A';
    if (totalValue >= t.B) return 'B';
    if (totalValue >= t.C) return 'C';
    if (totalValue >= t.D) return 'D';
    return 'F';
}

export { estimateAge, classifyTier, POSITION_AGE_CURVES, TIER_MULTIPLIERS, getAdjustedCurve };
