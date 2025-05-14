// src/kv_manager.ts

// --- Constants for KV Keys ---
const ADMIN_PASSWORD_HASH_KEY = ["admin_password_hash"];
const SINGLE_TRIGGER_KEY_KEY = ["single_trigger_key"];
const API_KEYS_KEY = ["api_keys"]; // Will store Record<string, string>
const API_KEY_POLL_INDEX_KEY = ["api_key_poll_index"];

const FALLBACK_API_KEY_KEY = ["fallback_api_key"];
const SECONDARY_POOL_MODEL_NAMES_KEY = ["secondary_pool_model_names"];

const FAILURE_THRESHOLD_KEY = ["failure_threshold"]; // Global retry threshold, not per-key failure count

let kv: Deno.Kv | null = null;

// --- Edge Cache (Deno Deploy Web Cache API) ---
const KV_MANAGER_CACHE_NAME = "kv-manager-cache";
const DEFAULT_EDGE_CACHE_TTL_SECONDS = 60; // 60 seconds

let edgeCacheInstance: Cache | undefined;

async function getEdgeCache(): Promise<Cache> {
    if (!edgeCacheInstance) {
        edgeCacheInstance = await caches.open(KV_MANAGER_CACHE_NAME);
    }
    return edgeCacheInstance;
}

function getEdgeCacheRequest(keyArray: string[]): Request {
    // Using a base URL, the path is what matters for cache key uniqueness
    const cacheKeyString = JSON.stringify(keyArray);
    const url = new URL(`/cache/${encodeURIComponent(cacheKeyString)}`, "http://localhost");
    return new Request(url);
}

/**
 * Opens and initializes the Deno KV store.
 */
export async function openKv(): Promise<Deno.Kv> {
    if (!kv) {
        kv = await Deno.openKv();
    }
    return kv;
}

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

// --- Single Trigger Key Management ---
export async function getTriggerKey(): Promise<string | null> {
    const kv = ensureKv();
    const cache = await getEdgeCache();
    const cacheRequest = getEdgeCacheRequest(SINGLE_TRIGGER_KEY_KEY);

    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
        try {
            const data = await cachedResponse.json();
            return data.value as (string | null);
        } catch (e) {
            console.error("Failed to parse cached JSON for getTriggerKey:", e);
            // Proceed to fetch from KV if cache is corrupted
        }
    }

    // Cache miss or corrupted, proceed to fetch from KV
    const result = await kv.get<string>(SINGLE_TRIGGER_KEY_KEY);
    const value = result.value || null;

    // Store in Edge Cache
    const responseToCache = new Response(JSON.stringify({ value }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${DEFAULT_EDGE_CACHE_TTL_SECONDS}`
        }
    });
    await cache.put(cacheRequest, responseToCache);

    return value;
}

export async function setTriggerKey(key: string | null): Promise<void> {
    const kv = ensureKv();
    const trimmedKey = key ? key.trim() : null;
    if (trimmedKey && trimmedKey.length > 0) {
        await kv.set(SINGLE_TRIGGER_KEY_KEY, trimmedKey);
    } else {
        await kv.delete(SINGLE_TRIGGER_KEY_KEY);
    }
    // Edge Cache entries expire based on TTL; no explicit clearCache needed or possible.
}

export async function clearTriggerKey(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(SINGLE_TRIGGER_KEY_KEY);
    // Edge Cache entries expire based on TTL; no explicit clearCache needed or possible.
}

export async function isValidTriggerKey(providedKey: string): Promise<boolean> {
    if (!providedKey) return false;
    const storedKey = await getTriggerKey();
    return storedKey !== null && storedKey === providedKey.trim();
}

// --- API Key (Primary Pool) Management ---
// Now stores and returns a Record<string, string> (JSON object)
export async function getApiKeys(): Promise<Record<string, string>> {
    const kv = ensureKv();
    const cache = await getEdgeCache();
    const cacheRequest = getEdgeCacheRequest(API_KEYS_KEY);

    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
        try {
            const data = await cachedResponse.json();
            return data.value as Record<string, string>;
        } catch (e) {
            console.error("Failed to parse cached JSON for getApiKeys:", e);
        }
    }

    const result = await kv.get<Record<string, string>>(API_KEYS_KEY);
    const value = result.value || {}; // Default to an empty object

    const responseToCache = new Response(JSON.stringify({ value }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${DEFAULT_EDGE_CACHE_TTL_SECONDS}`
        }
    });
    await cache.put(cacheRequest, responseToCache);

    return value;
}

// Input `keysToAdd` is a Record<string, string> where key is an identifier/name and value is the API key string.
export async function addApiKeys(keysToAdd: Record<string, string>): Promise<void> {
    const kv = ensureKv();
    // Fetching directly from KV to ensure we're merging with the latest persisted state,
    // as getApiKeys() might return a slightly stale cached version.
    const currentApiKeysResult = await kv.get<Record<string, string>>(API_KEYS_KEY);
    const currentApiKeysRecord = currentApiKeysResult.value || {};
    
    // Merge new keys. If a key identifier already exists, it will be overwritten.
    for (const keyIdentifier in keysToAdd) {
        if (Object.prototype.hasOwnProperty.call(keysToAdd, keyIdentifier)) {
            const apiKeyString = keysToAdd[keyIdentifier];
            if (typeof apiKeyString === 'string' && apiKeyString.trim().length > 0 && typeof keyIdentifier === 'string' && keyIdentifier.trim().length > 0) {
                currentApiKeysRecord[keyIdentifier.trim()] = apiKeyString.trim();
            }
        }
    }
    
    await kv.set(API_KEYS_KEY, currentApiKeysRecord);
    // Edge Cache entries expire based on TTL.
}

// `keyIdentifierToRemove` is the name/identifier of the API key entry.
export async function removeApiKey(keyIdentifierToRemove: string): Promise<void> {
    const kv = ensureKv();
    // Fetching directly from KV for atomicity of the read-modify-write operation.
    const currentApiKeysResult = await kv.get<Record<string, string>>(API_KEYS_KEY);
    const currentApiKeysRecord = currentApiKeysResult.value || {};
    
    if (Object.prototype.hasOwnProperty.call(currentApiKeysRecord, keyIdentifierToRemove)) {
        delete currentApiKeysRecord[keyIdentifierToRemove];
        await kv.set(API_KEYS_KEY, currentApiKeysRecord);
        // Edge Cache entries expire based on TTL.
    }
}

export async function clearAllApiKeys(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(API_KEYS_KEY);
    await kv.delete(API_KEY_POLL_INDEX_KEY); // This index is tied to the API_KEYS_KEY content
    // Edge Cache entries expire based on TTL.
}

// --- Failure Threshold Management ---
// This is a global threshold for retries in forwarder.ts, not related to individual key failure counts.
// No changes needed here based on "删除所有failureCount" as individual counts are not stored.
export async function getFailureThreshold(): Promise<number> {
    const kv = ensureKv();
    const cache = await getEdgeCache();
    const cacheRequest = getEdgeCacheRequest(FAILURE_THRESHOLD_KEY);

    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
        try {
            const data = await cachedResponse.json();
            return data.value as number;
        } catch (e) {
            console.error("Failed to parse cached JSON for getFailureThreshold:", e);
        }
    }

    const result = await kv.get<number>(FAILURE_THRESHOLD_KEY);
    const value = result.value ?? 5; // Default to 5 if not set

    const responseToCache = new Response(JSON.stringify({ value }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${DEFAULT_EDGE_CACHE_TTL_SECONDS}`
        }
    });
    await cache.put(cacheRequest, responseToCache);

    return value;
}

export async function setFailureThreshold(threshold: number): Promise<void> {
    const kv = ensureKv();
    await kv.set(FAILURE_THRESHOLD_KEY, threshold);
    // Edge Cache entries expire based on TTL.
}

// --- API Key Poll Index (Primary Pool) ---
async function getNextApiKeyPollIndexInternal(): Promise<number> {
    const kv = ensureKv();
    const result = await kv.get<number>(API_KEY_POLL_INDEX_KEY);
    return result.value ?? 0;
}

export async function getNextAvailableApiKey(): Promise<string | null> {
    const kv = ensureKv();
    const apiKeyRecord = await getApiKeys(); // Returns Record<string, string>
    const apiKeyValues = Object.values(apiKeyRecord); // Array of actual API key strings

    if (apiKeyValues.length === 0) {
        return null;
    }

    let committed = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!committed && attempts < maxAttempts) {
        attempts++;
        const currentEntry = await kv.get<number>(API_KEY_POLL_INDEX_KEY);
        const currentIndex = currentEntry.value ?? 0;
        
        let actualCurrentIndex = currentIndex;
        if (actualCurrentIndex >= apiKeyValues.length || actualCurrentIndex < 0) {
            actualCurrentIndex = 0;
        }
        
        const apiKeyToReturn = apiKeyValues[actualCurrentIndex]; // Get key from the array of values
        const nextIndex = (actualCurrentIndex + 1) % apiKeyValues.length;

        const res = await kv.atomic()
            .check(currentEntry)
            .set(API_KEY_POLL_INDEX_KEY, nextIndex)
            .commit();
        
        if (res.ok) {
            committed = true;
            return apiKeyToReturn;
        }
        console.warn(`Atomic update of API key poll index failed (attempt ${attempts}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 50 * attempts));
    }

    if (!committed) {
        console.error("Failed to atomically update API key poll index. Falling back to non-atomic read.");
        const fallbackIndex = await getNextApiKeyPollIndexInternal();
        let actualFallbackIndex = fallbackIndex;
        if (actualFallbackIndex >= apiKeyValues.length || actualFallbackIndex < 0) {
            actualFallbackIndex = 0;
        }
        return apiKeyValues[actualFallbackIndex]; // Get key from the array of values
    }
    return null; 
}

// --- Fallback API Key Management ---
export async function getFallbackApiKey(): Promise<string | null> {
    const kv = ensureKv();
    const cache = await getEdgeCache();
    const cacheRequest = getEdgeCacheRequest(FALLBACK_API_KEY_KEY);

    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
        try {
            const data = await cachedResponse.json();
            return data.value as (string | null);
        } catch (e) {
            console.error("Failed to parse cached JSON for getFallbackApiKey:", e);
        }
    }

    const result = await kv.get<string>(FALLBACK_API_KEY_KEY);
    const value = result.value || null;

    const responseToCache = new Response(JSON.stringify({ value }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${DEFAULT_EDGE_CACHE_TTL_SECONDS}`
        }
    });
    await cache.put(cacheRequest, responseToCache);

    return value;
}

export async function setFallbackApiKey(key: string | null): Promise<void> {
    const kv = ensureKv();
    const trimmedKey = key ? key.trim() : null;
    if (trimmedKey && trimmedKey.length > 0) {
        await kv.set(FALLBACK_API_KEY_KEY, trimmedKey);
    } else {
        await kv.delete(FALLBACK_API_KEY_KEY);
    }
    // Edge Cache entries expire based on TTL.
}

export async function clearFallbackApiKey(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(FALLBACK_API_KEY_KEY);
    // Edge Cache entries expire based on TTL.
}

// --- Fallback Trigger Model Names Management ---
export async function getSecondaryPoolModelNames(): Promise<Set<string>> {
    const kv = ensureKv();
    const cache = await getEdgeCache();
    const cacheRequest = getEdgeCacheRequest(SECONDARY_POOL_MODEL_NAMES_KEY);

    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
        try {
            // Expecting an array in the cache
            const data = await cachedResponse.json();
            return new Set(data.value as string[]);
        } catch (e) {
            console.error("Failed to parse cached JSON for getSecondaryPoolModelNames:", e);
        }
    }

    const result = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    const valueArray = result.value || [];
    const valueSet = new Set(valueArray);

    // Store as array in Edge Cache
    const responseToCache = new Response(JSON.stringify({ value: Array.from(valueSet) }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${DEFAULT_EDGE_CACHE_TTL_SECONDS}`
        }
    });
    await cache.put(cacheRequest, responseToCache);

    return valueSet;
}

export async function setSecondaryPoolModelNames(modelNames: string[]): Promise<void> {
    const kv = ensureKv();
    const valueToSet = Array.from(new Set(modelNames.map(name => name.trim()).filter(name => name.length > 0)));
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, valueToSet);
    // Edge Cache entries expire based on TTL.
}

export async function addSecondaryPoolModelNames(modelNames: string[]): Promise<void> {
    const kv = ensureKv();
    // Fetch directly from KV to ensure atomicity for read-modify-write
    const currentModelNamesResult = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    const currentModelNamesSet = new Set(currentModelNamesResult.value || []);
    
    modelNames.forEach(name => {
        const trimmedName = name.trim();
        if (trimmedName.length > 0) {
            currentModelNamesSet.add(trimmedName);
        }
    });
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, Array.from(currentModelNamesSet));
    // Edge Cache entries expire based on TTL.
}

export async function removeSecondaryPoolModelName(modelName: string): Promise<void> {
    const kv = ensureKv();
    // Fetch directly from KV
    const currentModelNamesResult = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    const currentModelNamesSet = new Set(currentModelNamesResult.value || []);

    currentModelNamesSet.delete(modelName.trim());
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, Array.from(currentModelNamesSet));
    // Edge Cache entries expire based on TTL.
}

export async function clearAllSecondaryPoolModelNames(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(SECONDARY_POOL_MODEL_NAMES_KEY);
    // Edge Cache entries expire based on TTL.
}

export async function shouldUseFallbackKey(modelName: string): Promise<boolean> {
    if (!modelName) return false;
    const fallbackModelNames = await getSecondaryPoolModelNames();
    return fallbackModelNames.has(modelName);
}

// Utility to clear all forwarding related data
export async function clearAllForwardingData(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(ADMIN_PASSWORD_HASH_KEY);
    await kv.delete(SINGLE_TRIGGER_KEY_KEY);
    await kv.delete(API_KEYS_KEY);
    await kv.delete(API_KEY_POLL_INDEX_KEY);
    await kv.delete(FALLBACK_API_KEY_KEY);
    await kv.delete(SECONDARY_POOL_MODEL_NAMES_KEY);
    await kv.delete(FAILURE_THRESHOLD_KEY);

    // Edge Cache entries expire based on TTL; no explicit clearCache needed or possible.
    // The KV entries themselves are deleted above, so subsequent reads will repopulate the cache.
}
