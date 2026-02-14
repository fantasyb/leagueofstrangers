import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { runFullAnalysis, listLeagueRosters } from '$lib/agent/index.js';

export async function GET({ url }) {
    const rosterId = url.searchParams.get('roster');

    if (!rosterId) {
        // Return list of rosters so user can pick theirs
        try {
            const rosters = await listLeagueRosters(leagueID);
            return json({ rosters, needsRosterSelection: true });
        } catch (e) {
            throw error(500, e.message);
        }
    }

    try {
        const analysis = await runFullAnalysis(leagueID, parseInt(rosterId));
        return json(analysis);
    } catch (e) {
        throw error(500, e.message);
    }
}
