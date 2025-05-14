// src/admin_api.ts

import * as kvManager from './kv_manager.ts';
// For password hashing, in a real app, use a proper library like bcrypt or Argon2.
// Deno's standard library `crypto.subtle` can be used for PBKDF2.
// For simplicity in this example, we'll simulate hashing.
// IMPORTANT: Replace with actual secure password hashing in production.
async function hashPassword(password: string): Promise<string> {
    // Placeholder: In a real app, use a strong hashing algorithm and salt.
    // Example using Web Crypto API (available in Deno)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    // Placeholder: Compare the hash of the input password with the stored hash.
    const inputHash = await hashPassword(password);
    return inputHash === storedHash;
}


// --- Request Handler for Admin API ---
export async function handleAdminApiRequest(request: Request, pathname: string): Promise<Response> {
    await kvManager.openKv(); // Ensure KV is open

    // For simplicity, we're not implementing full session management here.
    // In a real app, login should establish a session (e.g., secure cookie).
    // For now, some operations might be unprotected or use a simple check.
    // We'll assume a very basic password check for sensitive operations if no session.

    const method = request.method;

    try {
        if (pathname === "/api/admin/status") {
            return new Response(JSON.stringify({ message: "Admin API is active." }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        // --- Password Management ---
        if (pathname === "/api/admin/password-setup" && method === "POST") { // Initial setup
            const currentHash = await kvManager.getAdminPasswordHash();
            if (currentHash) {
                return new Response(JSON.stringify({ error: "Password already set up." }), { status: 409, headers: { "Content-Type": "application/json" } });
            }
            const { password } = await request.json();
            if (!password || typeof password !== 'string' || password.length < 8) {
                return new Response(JSON.stringify({ error: "Password must be a string of at least 8 characters." }), { status: 400, headers: { "Content-Type": "application/json" } });
            }
            const newHash = await hashPassword(password);
            await kvManager.setAdminPasswordHash(newHash);
            return new Response(JSON.stringify({ message: "Admin password set successfully." }), { status: 201 });
        }

        // All subsequent admin actions should ideally be protected by a session/login.
        // For now, we'll add a placeholder for a login check.
        // A real implementation would involve a /api/admin/login endpoint.
        const isAdminAuthenticated = async () => {
            // Placeholder: In a real app, check session cookie.
            // For now, we'll require a password for sensitive POST/DELETE if no session.
            // This is NOT secure for production.
            const adminPass = request.headers.get("X-Admin-Password");
            if (!adminPass) return false; 

            try {
                const storedHash = await kvManager.getAdminPasswordHash();
                if (!storedHash) {
                    // No password set in KV, so authentication is not possible.
                    // This implies password setup is not complete or hash is missing.
                    return false; 
                }
                return await verifyPassword(adminPass, storedHash);
            } catch (kvError) {
                // If any error occurs trying to get the password hash (e.g., KV unavailable)
                // then authentication cannot be confirmed. Log the error server-side.
                console.error("Error in isAdminAuthenticated while fetching stored hash:", kvError);
                return false; // Treat as not authenticated
            }
        };


        if (pathname === "/api/admin/login" && method === "POST") {
            const { password } = await request.json(); // password can be "" from the initial check

            const storedHash = await kvManager.getAdminPasswordHash();
            if (!storedHash) {
                // If no password is set up, this is the primary condition.
                // The frontend check sends an empty password, this allows it to correctly identify this state.
                return new Response(JSON.stringify({ error: "Admin password not set up." }), { status: 401 });
            }

            // If a password IS set up, then an actual password string is required for a valid login attempt.
            if (typeof password !== 'string' || password.length === 0) {
                return new Response(JSON.stringify({ error: "Password required" }), { status: 400 });
            }

            if (await verifyPassword(password, storedHash)) {
                // In a real app, set a secure, HTTP-only session cookie here.
                return new Response(JSON.stringify({ message: "Login successful" }), { status: 200 });
            } else {
                return new Response(JSON.stringify({ error: "Invalid password" }), { status: 401 });
            }
        }
        
        // --- Single Trigger Key Management ---
        if (pathname === "/api/admin/trigger-key") { // Renamed endpoint for clarity
            // Protect all methods for this path, including GET
            if (!await isAdminAuthenticated()) {
                return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }

            if (method === "GET") {
                const key = await kvManager.getTriggerKey();
                return new Response(JSON.stringify({ key: key }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (method === "POST") { // Sets or clears the single trigger key
                const { key } = await request.json(); // Expects { key: "theTriggerKey" } or { key: null } or { key: "" }
                if (key === undefined) {
                    return new Response(JSON.stringify({ error: "Invalid 'key' format. Expected a string or null." }), { status: 400 });
                }
                if (typeof key !== 'string' && key !== null) {
                     return new Response(JSON.stringify({ error: "Trigger key must be a string or null." }), { status: 400 });
                }
                await kvManager.setTriggerKey(key); // Handles empty string or null as clear
                return new Response(JSON.stringify({ message: "Trigger key updated." }), { status: 200 });
            }
            if (method === "DELETE") { // Clears the trigger key
                await kvManager.clearTriggerKey();
                return new Response(JSON.stringify({ message: "Trigger key cleared." }), { status: 200 });
            }
        }
        // The old "/api/admin/trigger-keys/all" is now covered by DELETE on "/api/admin/trigger-key"

        // --- API Keys (Pool) Management ---
        if (pathname === "/api/admin/api-keys") {
            if (!await isAdminAuthenticated()) { // Protect all methods for this path
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }
            if (method === "GET") {
                const keys = await kvManager.getApiKeys();
                return new Response(JSON.stringify(keys), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (method === "POST") {
                const { keys } = await request.json(); // Expects { keys: "key1,key2,key3" } or { keys: ["key1", "key2"] }
                 let keysArray: string[];
                if (typeof keys === 'string') {
                    keysArray = keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
                } else if (Array.isArray(keys)) {
                    keysArray = keys.map(k => String(k).trim()).filter(k => k.length > 0);
                } else {
                    return new Response(JSON.stringify({ error: "Invalid 'keys' format. Expected comma-separated string or array of strings." }), { status: 400 });
                }
                if (keysArray.length === 0) {
                     return new Response(JSON.stringify({ error: "No keys provided to add." }), { status: 400 });
                }

                // Convert string[] to Record<string, string>
                // Using the API key itself as the identifier for now.
                // This might need a more sophisticated approach if user-defined identifiers are desired via UI.
                const keysToAddAsRecord: Record<string, string> = {};
                for (const apiKeyStr of keysArray) {
                    keysToAddAsRecord[apiKeyStr] = apiKeyStr; 
                }

                await kvManager.addApiKeys(keysToAddAsRecord);
                return new Response(JSON.stringify({ message: "API keys added/updated." }), { status: 200 });
            }
            if (method === "DELETE") {
                // The `key` here should be the identifier used in the Record.
                // If we used the API key string itself as the identifier, then this is fine.
                const { key } = await request.json(); 
                 if (!key || typeof key !== 'string') {
                     return new Response(JSON.stringify({ error: "Missing or invalid 'key' (identifier) to delete." }), { status: 400 });
                }
                await kvManager.removeApiKey(key); // removeApiKey now expects the identifier
                return new Response(JSON.stringify({ message: `API key entry for '${key}' removed.` }), { status: 200 });
            }
        }

        // Endpoint to clear all API keys
        if (pathname === "/api/admin/api-keys/all" && method === "DELETE") {
            if (!await isAdminAuthenticated()) {
                return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
            }
            await kvManager.clearAllApiKeys();
            return new Response(JSON.stringify({ message: "All API keys and their stats cleared." }), { status: 200 });
        }

        // --- Fallback API Key Management ---
        if (pathname === "/api/admin/fallback-api-key") {
            if (!await isAdminAuthenticated()) { // Protect all methods
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }
            if (method === "GET") {
                const key = await kvManager.getFallbackApiKey();
                return new Response(JSON.stringify({ key: key }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (method === "POST") { // Sets or clears the single fallback key
                const { key } = await request.json(); // Expects { key: "theFallbackApiKey" } or { key: null } or { key: "" }
                if (key === undefined) { // Check if key property exists
                    return new Response(JSON.stringify({ error: "Invalid 'key' format. Expected a string or null." }), { status: 400 });
                }
                if (typeof key !== 'string' && key !== null) {
                     return new Response(JSON.stringify({ error: "Fallback key must be a string or null." }), { status: 400 });
                }
                await kvManager.setFallbackApiKey(key); // Handles empty string or null as clear
                return new Response(JSON.stringify({ message: "Fallback API key updated." }), { status: 200 });
            }
            if (method === "DELETE") { // Clears the fallback API key
                await kvManager.clearFallbackApiKey();
                return new Response(JSON.stringify({ message: "Fallback API key cleared." }), { status: 200 });
            }
        }
        // Note: "/api/admin/fallback-api-key/all" is not needed as there's only one key, handled by DELETE or POST with null/empty.

        // --- Fallback Trigger Model Names Management (formerly Secondary Pool Model Names) ---
        if (pathname === "/api/admin/secondary-pool-models") {
            if (!await isAdminAuthenticated()) { // Protect all methods
                return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }
            if (method === "GET") {
                const modelNames = await kvManager.getSecondaryPoolModelNames();
                return new Response(JSON.stringify(Array.from(modelNames)), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (method === "POST") { // Overwrites existing list
                const { models } = await request.json(); // Expects { models: "model1,model2" } or { models: ["model1", "model2"] }
                let modelsArray: string[];
                if (typeof models === 'string') {
                    modelsArray = models.split(',').map(m => m.trim()).filter(m => m.length > 0);
                } else if (Array.isArray(models)) {
                    modelsArray = models.map(m => String(m).trim()).filter(m => m.length > 0);
                } else {
                    return new Response(JSON.stringify({ error: "Invalid 'models' format. Provide a comma-separated string or an array of strings." }), { status: 400 });
                }
                // No check for empty array, allowing clearing by posting empty
                await kvManager.setSecondaryPoolModelNames(modelsArray);
                return new Response(JSON.stringify({ message: "Secondary pool model names set." }), { status: 200 });
            }
             // DELETE individual model name (not implemented for simplicity, use POST to overwrite)
        }
        
        if (pathname === "/api/admin/secondary-pool-models/clear" && method === "DELETE") {
            if (!await isAdminAuthenticated()) {
                return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
            }
            await kvManager.clearAllSecondaryPoolModelNames();
            return new Response(JSON.stringify({ message: "All secondary pool model names cleared." }), { status: 200 });
        }


        // --- Failure Threshold Management ---
        if (pathname === "/api/admin/failure-threshold") {
            if (!await isAdminAuthenticated()) { // Protect all methods
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }
            if (method === "GET") {
                const threshold = await kvManager.getFailureThreshold();
                return new Response(JSON.stringify({ threshold }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (method === "POST") {
                const { threshold } = await request.json();
                const numThreshold = parseInt(String(threshold), 10);
                if (isNaN(numThreshold) || numThreshold < 1) {
                    return new Response(JSON.stringify({ error: "Invalid threshold value. Must be a number greater than 0." }), { status: 400 });
                }
                await kvManager.setFailureThreshold(numThreshold);
                return new Response(JSON.stringify({ message: `Failure threshold set to ${numThreshold}.` }), { status: 200 });
            }
        }

        // --- Change Admin Password ---
        if (pathname === "/api/admin/change-password" && method === "POST") {
            if (!await isAdminAuthenticated()) { // Requires current password via X-Admin-Password
                 return new Response(JSON.stringify({ error: "Authentication required (current password)." }), { status: 401 });
            }
            const { newPassword } = await request.json();
            if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
                return new Response(JSON.stringify({ error: "New password must be a string of at least 8 characters." }), { status: 400 });
            }
            const newHash = await hashPassword(newPassword);
            await kvManager.setAdminPasswordHash(newHash);
            return new Response(JSON.stringify({ message: "Admin password changed successfully." }), { status: 200 });
        }


        return new Response(JSON.stringify({ error: "Admin API endpoint not found." }), { status: 404, headers: { "Content-Type": "application/json" } });

    } catch (error) {
        console.error("Error in admin API:", error);
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}

export function isAdminApiRequest(pathname: string): boolean {
    return pathname.startsWith("/api/admin/");
}
