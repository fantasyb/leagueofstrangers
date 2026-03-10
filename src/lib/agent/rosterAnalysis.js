/**
 * Roster Analysis & Lineup Optimizer
 *
 * Evaluates roster composition, optimizes weekly lineups,
 * and provides roster-level grading.
 */

import { rankRosterPlayers, getPositionBreakdown, buildPlayerProfile } from './playerAnalysis.js';
import { analyzeNeeds } from './tradeEngine.js';

/**
 * Full roster analysis: grade, positional breakdown, strengths, weaknesses.
 */
export function analyzeRoster(roster, playerData, rosterPositions, enrichment = {}) {
    const rankedPlayers = rankRosterPlayers(roster, playerData, enrichment);
    const breakdown = getPositionBreakdown(rankedPlayers);
    const needs = analyzeNeeds(rosterPositions, rankedPlayers);

    // Overall roster value
    const totalValue = rankedPlayers.reduce((sum, p) => sum + p.dynastyValue, 0);
    const avgAge = rankedPlayers.length > 0
        ? rankedPlayers.reduce((sum, p) => sum + p.age, 0) / rankedPlayers.length
        : 0;

    // Calculate overall grade
    const overallGrade = calculateOverallGrade(breakdown, totalValue);

    // Identify strengths and weaknesses
    const strengths = [];
    const weaknesses = [];

    for (const pos in breakdown) {
        const group = breakdown[pos];
        if (pos === 'K' || pos === 'DEF') continue;
        if (gradeValue(group.grade) >= 5) {
            strengths.push({
                position: pos,
                grade: group.grade,
                reason: `${group.players.filter(p => p.tier === 'elite' || p.tier === 'starter').length} quality starters`,
                topPlayer: group.players[0]?.name || 'N/A',
            });
        }
        if (gradeValue(group.grade) <= 3) {
            weaknesses.push({
                position: pos,
                grade: group.grade,
                reason: `Only ${group.players.filter(p => p.tier !== 'roster' && p.tier !== 'bench').length} startable players`,
                topPlayer: group.players[0]?.name || 'N/A',
            });
        }
    }

    // Roster construction analysis
    const starterCount = rankedPlayers.filter(p => p.tier === 'elite' || p.tier === 'starter').length;
    const depthCount = rankedPlayers.filter(p => p.tier === 'flex' || p.tier === 'bench').length;

    return {
        totalValue,
        overallGrade,
        avgAge: Math.round(avgAge * 10) / 10,
        playerCount: rankedPlayers.length,
        starterCount,
        depthCount,
        breakdown,
        needs,
        strengths,
        weaknesses,
        rankedPlayers,
        topPlayers: rankedPlayers.slice(0, 5),
        bottomPlayers: rankedPlayers.slice(-5).reverse(),
    };
}

function gradeValue(grade) {
    const map = { 'A+': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
    return map[grade] || 1;
}

/**
 * Calculate overall roster grade from position groups.
 */
function calculateOverallGrade(breakdown, totalValue) {
    // Weighted by importance: QB/RB/WR matter most
    const weights = { QB: 0.20, RB: 0.25, WR: 0.30, TE: 0.15, K: 0.05, DEF: 0.05 };
    let weightedScore = 0;

    for (const pos in weights) {
        const group = breakdown[pos];
        if (group) {
            weightedScore += gradeValue(group.grade) * weights[pos];
        }
    }

    if (weightedScore >= 5.5) return 'A+';
    if (weightedScore >= 4.8) return 'A';
    if (weightedScore >= 4.0) return 'B+';
    if (weightedScore >= 3.3) return 'B';
    if (weightedScore >= 2.5) return 'C+';
    if (weightedScore >= 2.0) return 'C';
    if (weightedScore >= 1.5) return 'D';
    return 'F';
}

/**
 * Optimize the weekly starting lineup based on projections.
 */
export function optimizeLineup(roster, playerData, rosterPositions, week = null) {
    const players = (roster.players || [])
        .map(pid => {
            const profile = buildPlayerProfile(pid, playerData);
            if (!profile) return null;

            // Get specific week projection or use average
            let weekPts = profile.avgProjection;
            const raw = playerData[pid];
            if (raw?.wi && week && raw.wi[week]?.p) {
                weekPts = parseFloat(raw.wi[week].p);
            }

            return { ...profile, projectedPts: weekPts };
        })
        .filter(Boolean);

    // Filter out injured players who are OUT or IR
    const available = players.filter(p =>
        !p.injuryStatus || !['Out', 'IR', 'Sus', 'PUP'].includes(p.injuryStatus)
    );

    // Sort available players by projected points within each position
    const byPosition = {};
    for (const p of available) {
        if (!byPosition[p.position]) byPosition[p.position] = [];
        byPosition[p.position].push(p);
    }
    for (const pos in byPosition) {
        byPosition[pos].sort((a, b) => b.projectedPts - a.projectedPts);
    }

    // Fill starting slots
    const starters = [];
    const used = new Set();
    const flexPool = [];

    // Define slot fill order and eligible positions
    const slotConfig = {
        QB: ['QB'],
        RB: ['RB'],
        WR: ['WR'],
        TE: ['TE'],
        K: ['K'],
        DEF: ['DEF'],
        FLEX: ['RB', 'WR', 'TE'],
        SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
        REC_FLEX: ['WR', 'TE'],
        WRRB_FLEX: ['WR', 'RB'],
        IDP_FLEX: ['DL', 'LB', 'DB'],
    };

    // First pass: fill positional slots
    const posSlots = rosterPositions.filter(s => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(s));
    const flexSlots = rosterPositions.filter(s => !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'BN'].includes(s));

    for (const slot of posSlots) {
        const eligible = (byPosition[slot] || []).filter(p => !used.has(p.id));
        if (eligible.length > 0) {
            starters.push({ ...eligible[0], slot });
            used.add(eligible[0].id);
        }
    }

    // Second pass: fill flex slots
    for (const slot of flexSlots) {
        if (slot === 'BN') continue;
        const eligiblePositions = slotConfig[slot] || [];
        const candidates = [];
        for (const pos of eligiblePositions) {
            candidates.push(...(byPosition[pos] || []).filter(p => !used.has(p.id)));
        }
        candidates.sort((a, b) => b.projectedPts - a.projectedPts);
        if (candidates.length > 0) {
            starters.push({ ...candidates[0], slot });
            used.add(candidates[0].id);
        }
    }

    // Bench = everyone not starting
    const bench = players.filter(p => !used.has(p.id))
        .sort((a, b) => b.projectedPts - a.projectedPts);

    const totalProjected = starters.reduce((sum, p) => sum + p.projectedPts, 0);

    return {
        starters,
        bench,
        totalProjected: Math.round(totalProjected * 100) / 100,
        week,
        warnings: generateLineupWarnings(starters, bench, rosterPositions),
    };
}

/**
 * Generate warnings about lineup issues.
 */
function generateLineupWarnings(starters, bench, rosterPositions) {
    const warnings = [];

    // Check for questionable starters
    const questionable = starters.filter(p => p.injuryStatus === 'Questionable');
    if (questionable.length > 0) {
        warnings.push({
            type: 'injury',
            severity: 'warning',
            message: `${questionable.map(p => p.name).join(', ')} ${questionable.length === 1 ? 'is' : 'are'} Questionable - monitor before kickoff`,
        });
    }

    // Check for bench players outprojecting starters at same position
    for (const benchPlayer of bench.slice(0, 5)) {
        const samePos = starters.filter(s => s.position === benchPlayer.position);
        for (const starter of samePos) {
            if (benchPlayer.projectedPts > starter.projectedPts + 2) {
                warnings.push({
                    type: 'projection',
                    severity: 'info',
                    message: `${benchPlayer.name} (${benchPlayer.projectedPts.toFixed(1)} pts) is projected higher than ${starter.name} (${starter.projectedPts.toFixed(1)} pts)`,
                });
            }
        }
    }

    // Check for bye weeks (players with no team)
    const noTeam = starters.filter(p => p.team === 'FA');
    if (noTeam.length > 0) {
        warnings.push({
            type: 'roster',
            severity: 'error',
            message: `${noTeam.map(p => p.name).join(', ')} may be a free agent - check status`,
        });
    }

    return warnings;
}

/**
 * Compare your roster against all league rosters.
 * Returns power rankings.
 */
export function leaguePowerRankings(rosters, playerData, rosterPositions, enrichment = {}) {
    const rankings = [];

    for (const rosterId in rosters) {
        const roster = rosters[rosterId];
        const analysis = analyzeRoster(roster, playerData, rosterPositions, enrichment);

        rankings.push({
            rosterId: parseInt(rosterId),
            teamName: roster.ownerName || `Team ${rosterId}`,
            totalValue: analysis.totalValue,
            overallGrade: analysis.overallGrade,
            avgAge: analysis.avgAge,
            starterCount: analysis.starterCount,
            topPlayer: analysis.topPlayers[0]?.name || 'N/A',
            record: roster.settings
                ? `${roster.settings.wins}-${roster.settings.losses}`
                : 'N/A',
        });
    }

    return rankings.sort((a, b) => b.totalValue - a.totalValue).map((r, i) => ({
        ...r,
        rank: i + 1,
    }));
}
