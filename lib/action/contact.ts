export async function addContactToDB(name: string, conversationKey: Uint8Array, roomId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const response = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, conversationKey: Array.from(conversationKey), roomId }),
        });

        if (!response.ok) {
            const text = await response.text();
            return { success: false, error: text || `HTTP ${response.status}` };
        }

        const data = await response.json();
        
        return { success: Boolean(data?.success), error: data?.error };
    } catch (err) {
        return { success: false, error: (err as Error).message || String(err) };
    }
}
