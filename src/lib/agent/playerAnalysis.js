/**
 * Player Analysis & Dynasty Value System
 *
 * Calculates dynasty trade values based on position, age, production,
 * and situational factors. Uses a 0-10000 point scale (KTC-style).
 */

// Position prime age ranges and decline curves
const POSITION_AGE_CURVES = {
    QB: { peakStart: 25, peakEnd: 33, declineRate: 0.06, longevity: 40, baseValue: 8000 },
    RB: { peakStart: 22, peakEnd: 27, declineRate: 0.15, longevity: 32, baseValue: 6500 },
    WR: { peakStart: 23, peakEnd: 30, declineRate: 0.08, longevity: 35, baseValue: 7500 },
    TE: { peakStart: 24, peakEnd: 31, declineRate: 0.07, longevity: 36, baseValue: 5500 },
    K:  { peakStart: 25, peakEnd: 36, declineRate: 0.03, longevity: 42, baseValue: 1000 },
    DEF:{ peakStart: 0,  peakEnd: 99, declineRate: 0.00, longevity: 99, baseValue: 1500 },
};

// Scoring tier multipliers - applied to base value
const TIER_MULTIPLIERS = {
    elite:     1.25,  // Top 3 at position
    starter:   1.00,  // Top 12 QB, Top 24 RB/WR, Top 12 TE
    flex:      0.70,  // Startable but not locked in
    bench:     0.40,  // Depth piece
    roster:    0.15,  // Roster stash / handcuff
};

/**
 * Calculate a player's dynasty value score (0-10000).
 */
export function calculateDynastyValue(player, stats = {}) {
    const pos = player.pos || player.position;
    const curve = POSITION_AGE_CURVES[pos];
    if (!curve) return 0;

    const age = player.age || estimateAge(player);
    const baseTier = classifyTier(player, stats);
    const tierMult = TIER_MULTIPLIERS[baseTier] || TIER_MULTIPLIERS.bench;

    // Age factor: 1.0 during prime, declining after
    let ageFactor = 1.0;
    if (age < curve.peakStart) {
        // Young players get a youth premium (upside)
        const yearsToGo = curve.peakStart - age;
        ageFactor = 0.85 + (yearsToGo * 0.04); // slight premium for youth
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

    // Injury discount
    if (player.is) {
        const injuryDiscount = getInjuryDiscount(player.is);
        value *= injuryDiscount;
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
        // Rough estimate: drafted at ~22 + years of experience
        return 22 + player.years_exp;
    }
    return 26; // default assumption
}

/**
 * Classify player into a production tier.
 */
function classifyTier(player, stats) {
    const weeklyPts = stats.avgPointsPerWeek || 0;
    const pos = player.pos || player.position;

    if (pos === 'QB') {
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

    // Normalize production across positions
    const benchmarks = { QB: 20, RB: 15, WR: 15, TE: 10, K: 8, DEF: 7 };
    const benchmark = benchmarks[pos] || 10;

    // Factor ranges from 0.3 (terrible) to 1.5 (elite)
    return Math.max(0.3, Math.min(1.5, 0.5 + (avg / benchmark) * 0.5));
}

/**
 * Apply injury-based discount to value.
 */
function getInjuryDiscount(injuryStatus) {
    const discounts = {
        'Out': 0.85,
        'Doubtful': 0.90,
        'Questionable': 0.95,
        'IR': 0.70,
        'PUP': 0.75,
        'Sus': 0.60,
        'COV': 0.90,
    };
    return discounts[injuryStatus] || 0.95;
}

/**
 * Build a full player profile with dynasty analysis.
 */
export function buildPlayerProfile(playerId, playerData, rosterContext = null) {
    const player = playerData[playerId];
    if (!player) return null;

    const pos = player.pos || player.position;
    const age = estimateAge({ ...player, years_exp: player.ye });
    const curve = POSITION_AGE_CURVES[pos] || POSITION_AGE_CURVES['WR'];

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

    const stats = { avgPointsPerWeek: avgProjection, totalPoints: avgProjection * 17 };
    const dynastyValue = calculateDynastyValue({ ...player, age }, stats);
    const tier = classifyTier({ ...player, age }, stats);

    // Championship window
    const yearsInPrime = age < curve.peakEnd ? curve.peakEnd - age : 0;
    const windowStatus = yearsInPrime > 4 ? 'Long Window' :
                         yearsInPrime > 2 ? 'Prime Window' :
                         yearsInPrime > 0 ? 'Closing Window' : 'Past Prime';

    return {
        id: playerId,
        name: `${player.fn} ${player.ln}`,
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
        outlook: generateOutlook(pos, age, tier, windowStatus, avgProjection),
    };
}

/**
 * Generate a text outlook for a player.
 */
function generateOutlook(pos, age, tier, windowStatus, avgPts) {
    const tierLabels = {
        elite: 'Elite',
        starter: 'Solid Starter',
        flex: 'Flex Option',
        bench: 'Bench Depth',
        roster: 'Roster Stash',
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

    return outlook;
}

/**
 * Rank all players on a roster by dynasty value.
 */
export function rankRosterPlayers(roster, playerData) {
    const profiles = [];
    const allPlayerIds = [
        ...(roster.players || []),
    ];

    for (const pid of allPlayerIds) {
        const profile = buildPlayerProfile(pid, playerData);
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
 */
function gradePositionGroup(pos, players) {
    const totalValue = players.reduce((sum, p) => sum + p.dynastyValue, 0);

    // Position-specific thresholds for grading
    const thresholds = {
        QB: { 'A+': 12000, A: 9000, B: 6500, C: 4000, D: 2000 },
        RB: { 'A+': 18000, A: 13000, B: 9000, C: 5000, D: 2500 },
        WR: { 'A+': 22000, A: 16000, B: 11000, C: 6000, D: 3000 },
        TE: { 'A+': 8000, A: 6000, B: 4000, C: 2500, D: 1200 },
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

export { estimateAge, classifyTier, POSITION_AGE_CURVES, TIER_MULTIPLIERS };
