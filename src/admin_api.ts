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
            const storedHash = await kvManager.getAdminPasswordHash();
            if (!storedHash) return false; // No password set
            return verifyPassword(adminPass, storedHash);
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
        
        // --- Trigger Keys Management ---
        if (pathname === "/api/admin/trigger-keys") {
            if (method === "GET") {
                const keys = await kvManager.getTriggerKeys();
                return new Response(JSON.stringify(Array.from(keys)), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (!await isAdminAuthenticated() && method !== "GET") { // Protect write operations
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
            }
            if (method === "POST") {
                const { keys } = await request.json(); // Expects { keys: "key1,key2,key3" } or { keys: ["key1", "key2"] }
                let keysArray: string[];
                if (typeof keys === 'string') {
                    keysArray = keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
                } else if (Array.isArray(keys)) {
                    keysArray = keys.map(k => String(k).trim()).filter(k => k.length > 0);
                } else {
                    return new Response(JSON.stringify({ error: "Invalid 'keys' format. Provide a comma-separated string or an array of strings." }), { status: 400 });
                }
                if (keysArray.length === 0) {
                     return new Response(JSON.stringify({ error: "No keys provided to add." }), { status: 400 });
                }
                await kvManager.addTriggerKeys(keysArray);
                return new Response(JSON.stringify({ message: "Trigger keys added." }), { status: 200 });
            }
            if (method === "DELETE") {
                const { key } = await request.json();
                if (!key || typeof key !== 'string') {
                     return new Response(JSON.stringify({ error: "Missing or invalid 'key' to delete." }), { status: 400 });
                }
                await kvManager.removeTriggerKey(key);
                return new Response(JSON.stringify({ message: `Trigger key '${key}' removed.` }), { status: 200 });
            }
        }

        // Endpoint to clear all trigger keys
        if (pathname === "/api/admin/trigger-keys/all" && method === "DELETE") {
            if (!await isAdminAuthenticated()) {
                return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
            }
            await kvManager.clearAllTriggerKeys();
            return new Response(JSON.stringify({ message: "All trigger keys cleared." }), { status: 200 });
        }

        // --- API Keys (Pool) Management ---
        if (pathname === "/api/admin/api-keys") {
            if (method === "GET") {
                const keys = await kvManager.getApiKeys();
                // For security, might not want to return full API keys.
                // Consider returning partial keys or just a count.
                // For this admin panel, we'll return them for management.
                return new Response(JSON.stringify(keys), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            if (!await isAdminAuthenticated() && method !== "GET") {
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
            }
            if (method === "POST") {
                const { keys } = await request.json(); // Expects { keys: "key1,key2,key3" } or { keys: ["key1", "key2"] }
                 let keysArray: string[];
                if (typeof keys === 'string') {
                    keysArray = keys.split(',').map(k => k.trim()).filter(k => k.length > 0);
                } else if (Array.isArray(keys)) {
                    keysArray = keys.map(k => String(k).trim()).filter(k => k.length > 0);
                } else {
                    return new Response(JSON.stringify({ error: "Invalid 'keys' format." }), { status: 400 });
                }
                if (keysArray.length === 0) {
                     return new Response(JSON.stringify({ error: "No keys provided to add." }), { status: 400 });
                }
                await kvManager.addApiKeys(keysArray);
                return new Response(JSON.stringify({ message: "API keys added." }), { status: 200 });
            }
            if (method === "DELETE") {
                const { key } = await request.json();
                 if (!key || typeof key !== 'string') {
                     return new Response(JSON.stringify({ error: "Missing or invalid 'key' to delete." }), { status: 400 });
                }
                await kvManager.removeApiKey(key);
                return new Response(JSON.stringify({ message: `API key '${key}' removed.` }), { status: 200 });
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

        // --- Failure Threshold Management ---
        if (pathname === "/api/admin/failure-threshold") {
            if (method === "GET") {
                const threshold = await kvManager.getFailureThreshold();
                return new Response(JSON.stringify({ threshold }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
             if (!await isAdminAuthenticated() && method !== "GET") {
                 return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
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
