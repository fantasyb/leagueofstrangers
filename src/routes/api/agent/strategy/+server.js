import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { getStrategyAssessment, getPowerRankings } from '$lib/agent/index.js';

export async function GET({ url }) {
    const rosterId = url.searchParams.get('roster');

    if (!rosterId) {
        throw error(400, 'Missing roster parameter');
    }

    try {
        const [strategy, rankings] = await Promise.all([
            getStrategyAssessment(leagueID, parseInt(rosterId)),
            getPowerRankings(leagueID),
        ]);

        return json({ strategy, rankings });
    } catch (e) {
        throw error(500, e.message);
    }
}
