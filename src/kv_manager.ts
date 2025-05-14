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
    const result = await kv.get<string>(SINGLE_TRIGGER_KEY_KEY);
    return result.value || null;
}

export async function setTriggerKey(key: string | null): Promise<void> {
    const kv = ensureKv();
    const trimmedKey = key ? key.trim() : null;
    if (trimmedKey && trimmedKey.length > 0) {
        await kv.set(SINGLE_TRIGGER_KEY_KEY, trimmedKey);
    } else {
        await kv.delete(SINGLE_TRIGGER_KEY_KEY);
    }
}

export async function clearTriggerKey(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(SINGLE_TRIGGER_KEY_KEY);
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
    const result = await kv.get<Record<string, string>>(API_KEYS_KEY);
    return result.value || {}; // Default to an empty object
}

// Input `keysToAdd` is a Record<string, string> where key is an identifier/name and value is the API key string.
export async function addApiKeys(keysToAdd: Record<string, string>): Promise<void> {
    const kv = ensureKv();
    const currentApiKeysResult = await kv.get<Record<string, string>>(API_KEYS_KEY);
    const currentApiKeysRecord = currentApiKeysResult.value || {};
    
    for (const keyIdentifier in keysToAdd) {
        if (Object.prototype.hasOwnProperty.call(keysToAdd, keyIdentifier)) {
            const apiKeyString = keysToAdd[keyIdentifier];
            if (typeof apiKeyString === 'string' && apiKeyString.trim().length > 0 && typeof keyIdentifier === 'string' && keyIdentifier.trim().length > 0) {
                currentApiKeysRecord[keyIdentifier.trim()] = apiKeyString.trim();
            }
        }
    }
    
    await kv.set(API_KEYS_KEY, currentApiKeysRecord);
}

// `keyIdentifierToRemove` is the name/identifier of the API key entry.
export async function removeApiKey(keyIdentifierToRemove: string): Promise<void> {
    const kv = ensureKv();
    const currentApiKeysResult = await kv.get<Record<string, string>>(API_KEYS_KEY);
    const currentApiKeysRecord = currentApiKeysResult.value || {};
    
    if (Object.prototype.hasOwnProperty.call(currentApiKeysRecord, keyIdentifierToRemove)) {
        delete currentApiKeysRecord[keyIdentifierToRemove];
        await kv.set(API_KEYS_KEY, currentApiKeysRecord);
    }
}

export async function clearAllApiKeys(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(API_KEYS_KEY);
    await kv.delete(API_KEY_POLL_INDEX_KEY);
}

// --- Failure Threshold Management ---
// This is a global threshold for retries in forwarder.ts, not related to individual key failure counts.
// No changes needed here based on "删除所有failureCount" as individual counts are not stored.
export async function getFailureThreshold(): Promise<number> {
    const kv = ensureKv();
    const result = await kv.get<number>(FAILURE_THRESHOLD_KEY);
    return result.value ?? 5; // Default to 5 if not set
}

export async function setFailureThreshold(threshold: number): Promise<void> {
    const kv = ensureKv();
    await kv.set(FAILURE_THRESHOLD_KEY, threshold);
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
    const result = await kv.get<string>(FALLBACK_API_KEY_KEY);
    return result.value || null;
}

export async function setFallbackApiKey(key: string | null): Promise<void> {
    const kv = ensureKv();
    const trimmedKey = key ? key.trim() : null;
    if (trimmedKey && trimmedKey.length > 0) {
        await kv.set(FALLBACK_API_KEY_KEY, trimmedKey);
    } else {
        await kv.delete(FALLBACK_API_KEY_KEY);
    }
}

export async function clearFallbackApiKey(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(FALLBACK_API_KEY_KEY);
}

// --- Fallback Trigger Model Names Management ---
export async function getSecondaryPoolModelNames(): Promise<Set<string>> {
    const kv = ensureKv();
    const result = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    return new Set(result.value || []);
}

export async function setSecondaryPoolModelNames(modelNames: string[]): Promise<void> {
    const kv = ensureKv();
    const valueToSet = Array.from(new Set(modelNames.map(name => name.trim()).filter(name => name.length > 0)));
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, valueToSet);
}

export async function addSecondaryPoolModelNames(modelNames: string[]): Promise<void> {
    const kv = ensureKv();
    const currentModelNamesResult = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    const currentModelNamesSet = new Set(currentModelNamesResult.value || []);
    
    modelNames.forEach(name => {
        const trimmedName = name.trim();
        if (trimmedName.length > 0) {
            currentModelNamesSet.add(trimmedName);
        }
    });
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, Array.from(currentModelNamesSet));
}

export async function removeSecondaryPoolModelName(modelName: string): Promise<void> {
    const kv = ensureKv();
    const currentModelNamesResult = await kv.get<string[]>(SECONDARY_POOL_MODEL_NAMES_KEY);
    const currentModelNamesSet = new Set(currentModelNamesResult.value || []);

    currentModelNamesSet.delete(modelName.trim());
    await kv.set(SECONDARY_POOL_MODEL_NAMES_KEY, Array.from(currentModelNamesSet));
}

export async function clearAllSecondaryPoolModelNames(): Promise<void> {
    const kv = ensureKv();
    await kv.delete(SECONDARY_POOL_MODEL_NAMES_KEY);
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
}
