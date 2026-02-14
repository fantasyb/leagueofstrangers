import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { getOptimalLineup } from '$lib/agent/index.js';

export async function GET({ url }) {
    const rosterId = url.searchParams.get('roster');
    const week = url.searchParams.get('week');

    if (!rosterId) {
        throw error(400, 'Missing roster parameter');
    }

    try {
        const lineup = await getOptimalLineup(
            leagueID,
            parseInt(rosterId),
            week ? parseInt(week) : null
        );
        return json(lineup);
    } catch (e) {
        throw error(500, e.message);
    }
}
