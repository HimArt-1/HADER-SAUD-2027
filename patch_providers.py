import re

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Add the broadcast helper function at the top after imports
    broadcast_helper = """
// Supabase Broadcast Helper for Dismissal Calls (Realtime fallback)
const broadcastDismissalEvent = async (event: string, callId: string) => {
    if (!supabaseStatus.isConfigured || typeof window === 'undefined') return;
    try {
        const channel = supabase.channel('dismissal_calls_sync');
        channel.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
                channel.send({
                    type: 'broadcast',
                    event: event,
                    payload: { id: callId }
                });
                setTimeout(() => supabase.removeChannel(channel), 1000);
            }
        });
    } catch (e) {
        console.warn('Failed to broadcast dismissal event', e);
    }
};
"""
    if "broadcastDismissalEvent" not in content:
        # Insert after the last import
        imports_end = content.rfind("import ")
        imports_end_line = content.find("\n", imports_end)
        content = content[:imports_end_line+1] + "\n" + broadcast_helper + content[imports_end_line+1:]

    # In addDismissalCall, after successful cloud insert, call broadcast
    # Look for the BroadcastChannel postMessage and insert our broadcast right before it
    bc_post_message_added = "bc.postMessage({ type: 'call_added'"
    if bc_post_message_added in content and "broadcastDismissalEvent('call_added'" not in content:
        content = content.replace(bc_post_message_added, 
            "broadcastDismissalEvent('call_added', syncable ? syncable.id : payload.id);\n                " + bc_post_message_added)

    bc_post_message_updated = "bc.postMessage({ type: 'call_updated'"
    if bc_post_message_updated in content and "broadcastDismissalEvent('call_updated'" not in content:
        content = content.replace(bc_post_message_updated, 
            "broadcastDismissalEvent('call_updated', callId);\n                " + bc_post_message_updated)

    # In subscribeToDismissalCalls, add the broadcast listeners to the Supabase channel
    channel_setup = ".channel('dismissal_calls_"
    if channel_setup in content and "'broadcast'" not in content:
        content = re.sub(
            r"(\.channel\('dismissal_calls_[a-z]+'\))",
            r"\1\n                .on('broadcast', { event: 'call_added' }, () => fetchAndCallback())\n                .on('broadcast', { event: 'call_updated' }, () => fetchAndCallback())",
            content
        )

    with open(filepath, 'w') as f:
        f.write(content)

patch_file('services/hybridProvider.ts')
patch_file('services/cloudProvider.ts')
print("Patched providers successfully.")
