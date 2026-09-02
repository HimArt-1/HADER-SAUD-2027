with open("services/cloudProvider.ts", "r") as f:
    content = f.read()

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

export class CloudProvider"""

content = content.replace("export class CloudProvider", broadcast_helper)

# In addDismissalCall
bc_post_message_added = "bc.postMessage({ type: 'call_added'"
content = content.replace(bc_post_message_added, "broadcastDismissalEvent('call_added', payload.id);\n        " + bc_post_message_added)

# In updateDismissalCallStatus
bc_post_message_updated = "bc.postMessage({ type: 'call_updated'"
content = content.replace(bc_post_message_updated, "broadcastDismissalEvent('call_updated', callId);\n        " + bc_post_message_updated)

# In subscribeToDismissalCalls
channel_setup = ".channel('dismissal_calls_cloud')"
content = content.replace(
    channel_setup,
    ".channel('dismissal_calls_cloud')\n      .on('broadcast', { event: 'call_added' }, () => fetchAndCallback())\n      .on('broadcast', { event: 'call_updated' }, () => fetchAndCallback())"
)

with open("services/cloudProvider.ts", "w") as f:
    f.write(content)

print("Patched cloudProvider successfully.")
