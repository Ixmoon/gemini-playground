import * as kvManager from './kv_manager.ts';
import * as forwarder from './forwarder.ts';
import * as adminApi from './admin_api.ts';

// Helper function to determine content type for static admin files
const getContentType = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    'js': 'application/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif'
    // Add other types if admin interface uses them
  };
  return types[ext] || 'text/plain';
};

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  console.log(`Request: ${req.method} ${req.url}`);

  // 1. Admin API Path
  // Check for Admin API requests first, as they might be under /admin/api/*
  if (adminApi.isAdminApiRequest(url.pathname)) {
    return adminApi.handleAdminApiRequest(req, url.pathname);
  }

  // 2. New Forwarder Path (for all other API calls like /api/...)
  if (forwarder.isForwarderRequest(url.pathname)) {
    return forwarder.handleForwardedRequest(req);
  }

  // 3. Static file handling for Admin Interface
  // This comes after Admin API and Forwarder checks
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    try {
      const cwd = Deno.cwd();
      const fullPath = `${cwd}/src/admin/admin.html`;
      console.log(`Attempting to serve admin panel: ${fullPath}`);
      const file = await Deno.readFile(fullPath);
      const contentType = getContentType(fullPath);
      return new Response(file, {
        headers: { 'content-type': `${contentType};charset=UTF-8` },
      });
    } catch (e) {
      console.error(`Error serving admin.html:`, e);
      return new Response('Admin panel not found.', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    }
  } else if (url.pathname.startsWith('/admin/')) {
    // Serve other static assets for the admin panel (e.g., /admin/admin.js, /admin/style.css)
    // This check ensures it's not an Admin API call, which was handled above.
    try {
      const cwd = Deno.cwd();
      const adminResource = url.pathname.substring('/admin/'.length); // e.g., "admin.js"
      if (!adminResource || adminResource.includes('..')) { // Basic security check
          return new Response('Invalid admin resource path.', { status: 400 });
      }
      const fullPath = `${cwd}/src/admin/${adminResource}`;
      console.log(`Attempting to serve admin static resource: ${fullPath}`);
      const file = await Deno.readFile(fullPath);
      const contentType = getContentType(fullPath);
      return new Response(file, {
        headers: { 'content-type': `${contentType};charset=UTF-8` },
      });
    } catch (e) {
      console.error(`Error serving admin resource ${url.pathname}:`, e);
      return new Response('Admin resource not found.', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    }
  }

  // If none of the above, it's a 404
  console.log(`No route matched for ${url.pathname}. Returning 404.`);
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
  });
}

async function main() {
  try {
    await kvManager.openKv();
    console.log("Deno KV store opened successfully.");
    // Any other initial setup for admin or general app can go here if needed in the future
  } catch (error) {
    console.error("Failed to initialize KV store or perform initial setup:", error);
    // Depending on the severity, you might want to exit or run in a degraded mode.
  }

  const port = parseInt(Deno.env.get("PORT") || "8080");
  Deno.serve({
    port: port,
    handler: handleRequest
  });
  console.log(`HTTP server running on port ${port}.`);
  console.log(`Access the admin interface at http://localhost:${port}/admin`);
  console.log(`API requests should be routed via paths defined in forwarder.ts (e.g., /api/...)`);
}

main();
