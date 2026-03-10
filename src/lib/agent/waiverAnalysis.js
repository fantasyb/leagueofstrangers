/**
 * Waiver Wire Intelligence
 *
 * Scours free agents, identifies pickup targets, recommends drops,
 * and generates prioritized add/drop recommendations.
 */

import { buildPlayerProfile, classifyMarketSignal, calculateDynastyValue } from './playerAnalysis.js';
import { getDraftCapitalFactor, getAthleticFactor, getScoutingProfile } from './nflDataClient.js';

/**
 * Scour the waiver wire for the best available players.
 * Returns categorized recommendations.
 */
export function scourWaivers(rosters, playerData, rosterPositions, myRosterId, enrichment = {}) {
    // Collect all rostered player IDs
    const rosteredIds = new Set();
    for (const rid in rosters) {
        const roster = rosters[rid];
        if (roster.players) {
            for (const pid of roster.players) {
                rosteredIds.add(pid);
            }
        }
    }

    // Find all unrostered players worth considering
    const freeAgents = [];
    for (const pid in playerData) {
        if (rosteredIds.has(pid)) continue;

        const p = playerData[pid];
        const pos = p.pos || p.position;

        // Skip non-skill positions and inactive players
        if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
        if (!p.t) continue; // No team = truly free agent / retired

        const profile = buildPlayerProfile(pid, playerData, enrichment);
        if (!profile) continue;

        // Only consider players with some value or upside
        if (profile.dynastyValue < 200 && profile.avgProjection < 3) continue;

        freeAgents.push(profile);
    }

    // Sort by dynasty value
    freeAgents.sort((a, b) => b.dynastyValue - a.dynastyValue);

    // Categorize
    const hotPickups = [];
    const stashCandidates = [];
    const streamingOptions = [];
    const handcuffs = [];

    for (const fa of freeAgents.slice(0, 100)) {
        const playerEnrichment = enrichment[fa.id] || {};
        const trendFactor = playerEnrichment.trendFactor || 1.0;

        // Hot Pickups: trending up or high current value
        if (trendFactor > 1.05 || fa.dynastyValue >= 1500) {
            hotPickups.push({
                ...fa,
                category: 'Hot Pickup',
                reason: trendFactor > 1.05
                    ? 'Trending up — production increasing'
                    : `High dynasty value (${fa.dynastyValue}) still on waivers`,
            });
        }

        // Stash Candidates: young with draft capital or athletic upside
        if (fa.age <= 24 && fa.position !== 'QB') {
            const playerName = `${fa.firstName} ${fa.lastName}`;
            const draftFactor = getDraftCapitalFactor(playerName, fa.yearsExp);
            const athleticFactor = getAthleticFactor(playerName, fa.position);

            if (draftFactor > 1.05 || athleticFactor > 1.02) {
                stashCandidates.push({
                    ...fa,
                    category: 'Stash',
                    reason: draftFactor > 1.05
                        ? 'Young with high draft capital — breakout potential'
                        : 'Athletic profile suggests upside',
                });
            }
        }

        // Streaming Options: decent projection this week
        if (fa.avgProjection >= 8 && fa.tier !== 'roster') {
            streamingOptions.push({
                ...fa,
                category: 'Streamer',
                reason: `Projected for ${fa.avgProjection.toFixed(1)} PPG — viable weekly starter`,
            });
        }

        // Handcuffs: backup RBs with value if starter gets hurt
        if (fa.position === 'RB' && fa.depthChartOrder && fa.depthChartOrder <= 3) {
            const depthLabel = fa.depthChartOrder === 2 ? 'RB2' : 'RB3';
            handcuffs.push({
                ...fa,
                category: 'Handcuff',
                reason: `${depthLabel} on ${fa.team} — one injury away from opportunity`,
            });
        }
    }

    return {
        hotPickups: hotPickups.slice(0, 10),
        stashCandidates: stashCandidates.slice(0, 10),
        streamingOptions: streamingOptions.slice(0, 8),
        handcuffs: handcuffs.slice(0, 8),
        totalFreeAgents: freeAgents.length,
        topOverall: freeAgents.slice(0, 15).map(fa => ({
            ...fa,
            category: 'Top Available',
            reason: `Dynasty value: ${fa.dynastyValue}`,
        })),
    };
}

/**
 * Recommend players to drop from a roster.
 * Identifies roster cloggers: declining, injured, no path to starts.
 */
export function recommendDrops(myRoster, playerData, waiverTargets, enrichment = {}) {
    const myPlayers = [];
    for (const pid of myRoster.players || []) {
        const profile = buildPlayerProfile(pid, playerData, enrichment);
        if (profile) myPlayers.push(profile);
    }

    const dropCandidates = [];

    for (const player of myPlayers) {
        let dropScore = 0;
        const reasons = [];
        const playerEnrichment = enrichment[player.id] || {};
        const trendFactor = playerEnrichment.trendFactor || 1.0;

        // Low dynasty value
        if (player.dynastyValue < 500) {
            dropScore += 30;
            reasons.push(`Very low dynasty value (${player.dynastyValue})`);
        } else if (player.dynastyValue < 1000) {
            dropScore += 15;
            reasons.push(`Low dynasty value (${player.dynastyValue})`);
        }

        // Past prime
        if (player.windowStatus === 'Past Prime') {
            dropScore += 25;
            reasons.push('Past prime production years');
        }

        // Declining production
        if (trendFactor < 0.90) {
            dropScore += 20;
            reasons.push('Production trending down significantly');
        }

        // No team / free agent
        if (player.team === 'FA' || !player.team) {
            dropScore += 35;
            reasons.push('Not on an NFL roster');
        }

        // Deep depth chart
        if (player.depthChartOrder && player.depthChartOrder >= 4) {
            dropScore += 15;
            reasons.push(`Buried on depth chart (#${player.depthChartOrder})`);
        }

        // Roster-tier player
        if (player.tier === 'roster') {
            dropScore += 20;
            reasons.push('Roster-level talent');
        }

        // Injury
        if (player.injuryStatus === 'IR' || player.injuryStatus === 'PUP') {
            dropScore += 10;
            reasons.push(`Currently on ${player.injuryStatus}`);
        }

        if (dropScore >= 25) {
            dropCandidates.push({
                ...player,
                dropScore,
                dropReasons: reasons,
            });
        }
    }

    // Sort by drop score (highest = should drop first)
    dropCandidates.sort((a, b) => b.dropScore - a.dropScore);

    return dropCandidates.slice(0, 10);
}

/**
 * Generate prioritized add/drop swap recommendations.
 * Pairs the best waiver targets with the most droppable roster players.
 */
export function generateSwapRecommendations(drops, waiverTargets) {
    const allTargets = [
        ...(waiverTargets.hotPickups || []),
        ...(waiverTargets.stashCandidates || []),
        ...(waiverTargets.streamingOptions || []),
        ...(waiverTargets.handcuffs || []),
    ];

    // Deduplicate targets
    const seenIds = new Set();
    const uniqueTargets = allTargets.filter(t => {
        if (seenIds.has(t.id)) return false;
        seenIds.add(t.id);
        return true;
    });

    // Sort targets by dynasty value
    uniqueTargets.sort((a, b) => b.dynastyValue - a.dynastyValue);

    const swaps = [];

    for (const drop of drops) {
        // Find the best available add at the same position (or any position if value difference is large)
        const samePositionTargets = uniqueTargets.filter(t =>
            t.position === drop.position && !swaps.some(s => s.add.id === t.id)
        );

        const bestSamePos = samePositionTargets[0];
        if (bestSamePos && bestSamePos.dynastyValue > drop.dynastyValue) {
            swaps.push({
                drop: {
                    id: drop.id,
                    name: drop.name,
                    position: drop.position,
                    team: drop.team,
                    dynastyValue: drop.dynastyValue,
                    dropReasons: drop.dropReasons,
                },
                add: {
                    id: bestSamePos.id,
                    name: bestSamePos.name,
                    position: bestSamePos.position,
                    team: bestSamePos.team,
                    dynastyValue: bestSamePos.dynastyValue,
                    category: bestSamePos.category,
                    reason: bestSamePos.reason,
                },
                valueDiff: bestSamePos.dynastyValue - drop.dynastyValue,
                priority: bestSamePos.dynastyValue - drop.dynastyValue > 1000 ? 'High' :
                         bestSamePos.dynastyValue - drop.dynastyValue > 500 ? 'Medium' : 'Low',
            });
            continue;
        }

        // Try any position if the value difference is significant
        const anyTarget = uniqueTargets.find(t =>
            !swaps.some(s => s.add.id === t.id) &&
            t.dynastyValue > drop.dynastyValue + 300
        );

        if (anyTarget) {
            swaps.push({
                drop: {
                    id: drop.id,
                    name: drop.name,
                    position: drop.position,
                    team: drop.team,
                    dynastyValue: drop.dynastyValue,
                    dropReasons: drop.dropReasons,
                },
                add: {
                    id: anyTarget.id,
                    name: anyTarget.name,
                    position: anyTarget.position,
                    team: anyTarget.team,
                    dynastyValue: anyTarget.dynastyValue,
                    category: anyTarget.category,
                    reason: anyTarget.reason,
                },
                valueDiff: anyTarget.dynastyValue - drop.dynastyValue,
                priority: anyTarget.dynastyValue - drop.dynastyValue > 1000 ? 'High' :
                         anyTarget.dynastyValue - drop.dynastyValue > 500 ? 'Medium' : 'Low',
            });
        }
    }

    // Sort by value differential
    swaps.sort((a, b) => b.valueDiff - a.valueDiff);

    return swaps;
}

/**
 * Full waiver analysis: scour waivers + recommend drops + generate swaps.
 */
export function runWaiverAnalysis(rosters, playerData, rosterPositions, myRosterId, enrichment = {}) {
    const myRoster = rosters[myRosterId];
    if (!myRoster) return null;

    const waiverTargets = scourWaivers(rosters, playerData, rosterPositions, myRosterId, enrichment);
    const dropCandidates = recommendDrops(myRoster, playerData, waiverTargets, enrichment);
    const swapRecommendations = generateSwapRecommendations(dropCandidates, waiverTargets);

    return {
        waiverTargets,
        dropCandidates,
        swapRecommendations,
        summary: {
            totalFreeAgents: waiverTargets.totalFreeAgents,
            hotPickupCount: waiverTargets.hotPickups.length,
            stashCount: waiverTargets.stashCandidates.length,
            dropCandidateCount: dropCandidates.length,
            swapCount: swapRecommendations.length,
            highPrioritySwaps: swapRecommendations.filter(s => s.priority === 'High').length,
        },
    };
}
