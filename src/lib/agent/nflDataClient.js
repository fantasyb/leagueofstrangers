/**
 * NFL Data Client
 *
 * Provides draft capital and combine data for player analysis.
 * Uses static JSON data files with optional PFR scraping fallback.
 */

import draftCapitalData from './data/draftCapital.json';
import combineDataFile from './data/combineData.json';

/**
 * Get NFL draft capital for a player.
 * Returns { year, round, pick, team } or null.
 */
export function getDraftCapital(playerName) {
    if (!playerName) return null;
    return draftCapitalData[playerName] || null;
}

/**
 * Get NFL Combine data for a player.
 * Returns measurables object or null.
 */
export function getCombineData(playerName) {
    if (!playerName) return null;
    return combineDataFile[playerName] || null;
}

/**
 * Calculate a composite athletic score (0-10) from combine data.
 * Weights: 40-yard (35%), vertical (20%), broad (20%), bench (10%), agility (15%)
 */
export function getAthleticScore(combineData, position = 'WR') {
    if (!combineData) return null;

    const benchmarks = POSITION_BENCHMARKS[position] || POSITION_BENCHMARKS['WR'];
    let totalWeight = 0;
    let weightedScore = 0;

    if (combineData.forty) {
        // Lower is better for 40
        const score = Math.max(0, Math.min(10,
            10 - ((combineData.forty - benchmarks.forty.elite) / (benchmarks.forty.poor - benchmarks.forty.elite)) * 10
        ));
        weightedScore += score * 0.35;
        totalWeight += 0.35;
    }

    if (combineData.vertical) {
        const score = Math.max(0, Math.min(10,
            ((combineData.vertical - benchmarks.vertical.poor) / (benchmarks.vertical.elite - benchmarks.vertical.poor)) * 10
        ));
        weightedScore += score * 0.20;
        totalWeight += 0.20;
    }

    if (combineData.broad) {
        const score = Math.max(0, Math.min(10,
            ((combineData.broad - benchmarks.broad.poor) / (benchmarks.broad.elite - benchmarks.broad.poor)) * 10
        ));
        weightedScore += score * 0.20;
        totalWeight += 0.20;
    }

    if (combineData.bench) {
        const score = Math.max(0, Math.min(10,
            ((combineData.bench - benchmarks.bench.poor) / (benchmarks.bench.elite - benchmarks.bench.poor)) * 10
        ));
        weightedScore += score * 0.10;
        totalWeight += 0.10;
    }

    if (combineData.cone) {
        // Lower is better
        const score = Math.max(0, Math.min(10,
            10 - ((combineData.cone - benchmarks.cone.elite) / (benchmarks.cone.poor - benchmarks.cone.elite)) * 10
        ));
        weightedScore += score * 0.075;
        totalWeight += 0.075;
    }

    if (combineData.shuttle) {
        // Lower is better
        const score = Math.max(0, Math.min(10,
            10 - ((combineData.shuttle - benchmarks.shuttle.elite) / (benchmarks.shuttle.poor - benchmarks.shuttle.elite)) * 10
        ));
        weightedScore += score * 0.075;
        totalWeight += 0.075;
    }

    if (totalWeight === 0) return null;

    return Math.round((weightedScore / totalWeight) * 10) / 10;
}

/**
 * Get draft capital value factor for dynasty calculations.
 * Returns a multiplier (0.90 - 1.20) based on where they were drafted.
 * Only applied for players with ≤ 3 years experience (capital matters less over time).
 */
export function getDraftCapitalFactor(playerName, yearsExp) {
    const capital = getDraftCapital(playerName);
    if (!capital) return 1.0;

    // Draft capital matters less as players prove (or don't prove) themselves
    const experienceDecay = Math.max(0, 1 - (yearsExp || 0) * 0.25);
    if (experienceDecay <= 0) return 1.0;

    let baseFactor;
    if (capital.round === 1 && capital.pick <= 10) {
        baseFactor = 1.20; // Top 10 pick
    } else if (capital.round === 1) {
        baseFactor = 1.15; // Late 1st
    } else if (capital.round === 2) {
        baseFactor = 1.08; // 2nd round
    } else if (capital.round === 3) {
        baseFactor = 1.03; // 3rd round
    } else if (capital.round >= 5 || capital.round === 0) {
        baseFactor = 0.92; // Day 3 / UDFA
    } else {
        baseFactor = 1.0; // 4th round
    }

    // Blend toward 1.0 based on experience
    return 1.0 + (baseFactor - 1.0) * experienceDecay;
}

/**
 * Get athletic profile factor for dynasty value.
 * Returns a multiplier (0.95 - 1.05) based on athletic testing.
 */
export function getAthleticFactor(playerName, position) {
    const combine = getCombineData(playerName);
    if (!combine) return 1.0;

    const score = getAthleticScore(combine, position);
    if (score === null) return 1.0;

    // Score 0-10, map to 0.95-1.05 range
    return 0.95 + (score / 10) * 0.10;
}

/**
 * Get full scouting profile for a player.
 * Combines draft capital + combine data into a single profile.
 */
export function getScoutingProfile(playerName, position) {
    const draft = getDraftCapital(playerName);
    const combine = getCombineData(playerName);
    const athleticScore = combine ? getAthleticScore(combine, position) : null;

    return {
        draftCapital: draft ? {
            year: draft.year,
            round: draft.round,
            pick: draft.pick,
            draftTeam: draft.team,
            label: draft.round === 0 ? 'UDFA' :
                   `Round ${draft.round}, Pick ${draft.pick} (${draft.year})`,
        } : null,
        combine: combine ? {
            forty: combine.forty,
            vertical: combine.vertical,
            broad: combine.broad,
            bench: combine.bench,
            cone: combine.cone,
            shuttle: combine.shuttle,
            height: combine.height,
            weight: combine.weight,
            athleticScore,
            athleticGrade: athleticScore >= 8 ? 'Elite' :
                          athleticScore >= 6.5 ? 'Above Average' :
                          athleticScore >= 5 ? 'Average' :
                          athleticScore >= 3.5 ? 'Below Average' : 'Poor',
        } : null,
    };
}

/**
 * Position-specific combine benchmarks for athletic scoring.
 */
const POSITION_BENCHMARKS = {
    QB: {
        forty:    { elite: 4.40, poor: 5.00 },
        vertical: { elite: 38, poor: 28 },
        broad:    { elite: 128, poor: 110 },
        bench:    { elite: 25, poor: 12 },
        cone:     { elite: 6.80, poor: 7.40 },
        shuttle:  { elite: 4.10, poor: 4.50 },
    },
    RB: {
        forty:    { elite: 4.35, poor: 4.65 },
        vertical: { elite: 40, poor: 30 },
        broad:    { elite: 130, poor: 115 },
        bench:    { elite: 25, poor: 14 },
        cone:     { elite: 6.75, poor: 7.20 },
        shuttle:  { elite: 4.10, poor: 4.40 },
    },
    WR: {
        forty:    { elite: 4.30, poor: 4.60 },
        vertical: { elite: 40, poor: 30 },
        broad:    { elite: 130, poor: 115 },
        bench:    { elite: 20, poor: 8 },
        cone:     { elite: 6.70, poor: 7.15 },
        shuttle:  { elite: 4.05, poor: 4.35 },
    },
    TE: {
        forty:    { elite: 4.45, poor: 4.80 },
        vertical: { elite: 38, poor: 28 },
        broad:    { elite: 128, poor: 112 },
        bench:    { elite: 25, poor: 15 },
        cone:     { elite: 6.85, poor: 7.30 },
        shuttle:  { elite: 4.15, poor: 4.50 },
    },
};

export { POSITION_BENCHMARKS };
