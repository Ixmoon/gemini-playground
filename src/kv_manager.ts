// src/kv_manager.ts

// --- Constants for KV Keys ---
const ADMIN_PASSWORD_HASH_KEY = ["admin_password_hash"];
const TRIGGER_KEYS_KEY = ["trigger_keys"]; // Stores a Set<string>
const API_KEYS_KEY = ["api_keys"]; // Stores a Set<string>
const FAILURE_THRESHOLD_KEY = ["failure_threshold"]; // Stores a number
// const API_KEY_STATS_PREFIX = ["api_key_stats"]; // Prefix for individual key stats // REMOVED
const API_KEY_POLL_INDEX_KEY = ["api_key_poll_index"]; // Stores the index of the next API key to use

let kv: Deno.Kv | null = null;

/**
 * Opens and initializes the Deno KV store.
 * This should be called once when the application starts.
 */
export async function openKv(): Promise<Deno.Kv> {
    if (!kv) {
        kv = await Deno.openKv();
    }
    return kv;
}

/**
 * Ensures KV is open. Throws an error if not.
 */
function ensureKv(): Deno.Kv {
    if (!kv) {
        throw new Error("Deno KV store is not open. Call openKv() first.");
    }
    return kv;
}

// --- Admin Password Management ---
export async function getAdminPasswordHash(): Promise<string | null> {
    const kv = ensureKv();
    const result = await kv.get<string>(ADMIN_PASSWORD_HASH_KEY);
    return result.value;
}

export async function setAdminPasswordHash(hash: string): Promise<void> {
    const kv = ensureKv();
    await kv.set(ADMIN_PASSWORD_HASH_KEY, hash);
}

// --- Trigger Key Management ---
export async function getTriggerKeys(): Promise<Set<string>> {
    const kv = ensureKv();
    const result = await kv.get<string[]>(TRIGGER_KEYS_KEY);
    return new Set(result.value || []);
}

export async function addTriggerKeys(keys: string[]): Promise<void> {
    const kv = ensureKv();
    const currentKeys = await getTriggerKeys();
    keys.forEach(key => currentKeys.add(key.trim()));
    await kv.set(TRIGGER_KEYS_KEY, Array.from(currentKeys));
}

export async function removeTriggerKey(key: string): Promise<void> {
    const kv = ensureKv();
    const currentKeys = await getTriggerKeys();
    currentKeys.delete(key.trim());
    await kv.set(TRIGGER_KEYS_KEY, Array.from(currentKeys));
}

export async function isValidTriggerKey(key: string): Promise<boolean> {
    const keys = await getTriggerKeys();
    return keys.has(key);
}

export async function clearAllTriggerKeys(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(TRIGGER_KEYS_KEY);
    console.log("All trigger keys have been cleared.");
}

// --- API Key (Pool) Management ---
export async function getApiKeys(): Promise<string[]> {
    const kv = ensureKv();
    const result = await kv.get<string[]>(API_KEYS_KEY);
    return result.value || [];
}

export async function addApiKeys(keys: string[]): Promise<void> {
    const kv = ensureKv();
    const currentKeys = new Set(await getApiKeys());
    keys.forEach(key => currentKeys.add(key.trim()));
    await kv.set(API_KEYS_KEY, Array.from(currentKeys));
}

export async function removeApiKey(key: string): Promise<void> {
    const kv = ensureKv();
    const currentKeys = new Set(await getApiKeys());
    currentKeys.delete(key.trim());
    await kv.set(API_KEYS_KEY, Array.from(currentKeys));
    // Also remove associated stats // REMOVED
    // await kv.delete([...API_KEY_STATS_PREFIX, key.trim()]); // REMOVED
}

export async function clearAllApiKeys(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(API_KEYS_KEY);
    await kv.delete(API_KEY_POLL_INDEX_KEY);

    // Delete all individual API key stats // REMOVED
    // const iter = kv.list<ApiKeyStat>({ prefix: API_KEY_STATS_PREFIX }); // REMOVED
    // for await (const entry of iter) { // REMOVED
    //     await kv.delete(entry.key); // REMOVED
    // } // REMOVED
    console.log("All API keys and their stats have been cleared.");
}

// --- Failure Threshold Management ---
export async function getFailureThreshold(): Promise<number> {
    const kv = ensureKv();
    const result = await kv.get<number>(FAILURE_THRESHOLD_KEY);
    return result.value ?? 5; // Default to 5
}

export async function setFailureThreshold(threshold: number): Promise<void> {
    const kv = ensureKv();
    await kv.set(FAILURE_THRESHOLD_KEY, threshold);
}

// --- API Key Polling and Stats Management --- // REMOVED STATS MANAGEMENT
// interface ApiKeyStat { // REMOVED
//     failureCount: number; // REMOVED
//     // lastUsed?: number; // Could be added for more sophisticated polling // REMOVED
// } // REMOVED

// export async function getApiKeyStat(apiKey: string): Promise<ApiKeyStat> { // REMOVED
//     const kv = ensureKv(); // REMOVED
//     const result = await kv.get<ApiKeyStat>([...API_KEY_STATS_PREFIX, apiKey]); // REMOVED
//     return result.value ?? { failureCount: 0 }; // REMOVED
// } // REMOVED

// export async function incrementApiKeyFailure(apiKey: string): Promise<void> { // REMOVED
//     const kv = ensureKv(); // REMOVED
//     const stat = await getApiKeyStat(apiKey); // REMOVED
//     stat.failureCount += 1; // REMOVED
//     await kv.set([...API_KEY_STATS_PREFIX, apiKey], stat); // REMOVED
// } // REMOVED

// export async function resetApiKeyStats(apiKey: string): Promise<void> { // REMOVED
//     const kv = ensureKv(); // REMOVED
//     await kv.set([...API_KEY_STATS_PREFIX, apiKey], { failureCount: 0 }); // REMOVED
// } // REMOVED

export async function getNextApiKeyPollIndex(): Promise<number> {
    const kv = ensureKv();
    const result = await kv.get<number>(API_KEY_POLL_INDEX_KEY);
    return result.value ?? 0;
}

export async function setNextApiKeyPollIndex(index: number): Promise<void> {
    const kv = ensureKv();
    await kv.set(API_KEY_POLL_INDEX_KEY, index);
}

/**
 * Selects the next API key from the pool using simple round-robin.
 * Individual key failure counts or thresholds are NOT considered by this function for filtering.
 * The failure threshold (from `getFailureThreshold()`) is used by `forwarder.ts` to limit
 * its own distinct key retry attempts for a single incoming request.
 * Returns null if the API key pool is empty.
 */
export async function getNextAvailableApiKey(): Promise<string | null> {
    const apiKeys = await getApiKeys();
    if (apiKeys.length === 0) {
        return null;
    }

    // Perform simple round-robin. Individual key failure counts are no longer used to filter keys here.
    // The failureThreshold is primarily used by forwarder.ts to limit distinct key attempts per request.
    let currentIndex = await getNextApiKeyPollIndex();

    // Ensure currentIndex is within bounds, especially if keys were removed.
    if (currentIndex >= apiKeys.length || currentIndex < 0) {
        currentIndex = 0;
    }

    const apiKey = apiKeys[currentIndex];
    // Set the index for the *next* call to be the one after the current one.
    await setNextApiKeyPollIndex((currentIndex + 1) % apiKeys.length);
    return apiKey;
}

// Utility to clear all forwarding related data (for testing or reset)
export async function clearAllForwardingData(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(ADMIN_PASSWORD_HASH_KEY);
    await kv.delete(TRIGGER_KEYS_KEY);
    await kv.delete(API_KEYS_KEY);
    await kv.delete(FAILURE_THRESHOLD_KEY);
    await kv.delete(API_KEY_POLL_INDEX_KEY);

    // Delete all individual API key stats // REMOVED
    // const iter = kv.list<ApiKeyStat>({ prefix: API_KEY_STATS_PREFIX }); // REMOVED
    // for await (const entry of iter) { // REMOVED
    //     await kv.delete(entry.key); // REMOVED
    // } // REMOVED
    console.log("All forwarding-related KV data has been cleared.");
}
