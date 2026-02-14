export async function load({ fetch, url }) {
    const rosterId = url.searchParams.get('roster');

    // If no roster selected, fetch roster list for selection
    if (!rosterId) {
        const res = await fetch('/api/agent/analyze');
        const data = await res.json();
        return { needsRosterSelection: true, rosters: data.rosters || [] };
    }

    // Fetch the full analysis
    const analysisPromise = fetch(`/api/agent/analyze?roster=${rosterId}`).then(r => r.json());

    return {
        needsRosterSelection: false,
        rosterId: parseInt(rosterId),
        analysisPromise,
    };
}
