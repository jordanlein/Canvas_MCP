# Canvas MCP Home Assistant Add-on

Read-only Remote MCP server for Canvas LMS, packaged as a Home Assistant add-on.

## Features
- Streamable HTTP transport (Server-Sent Events) on port 8080
- Read-only Canvas access (GET only)
- Optional Bearer auth for `/mcp` endpoint via `MCP_AUTH_TOKEN`
- Pagination, normalized outputs, robust error handling and timeouts

## Installation
1. Open Home Assistant → Settings → Add-ons → Add-on Store.
2. Click the three dots (⋮) → Repositories → Add:
   - Repository URL: this GitHub repository (e.g., `https://github.com/YOUR_GITHUB_ORG/YOUR_REPO`).
3. After adding, search for "Canvas MCP" in the Add-on Store and click Install.

The add-on uses a prebuilt Docker image hosted on GHCR. No local build is required.

## Configuration

Set these options in the add-on configuration panel:
- `canvas_base_url` (required): Your Canvas instance base URL (e.g., `https://yourschool.instructure.com`).
- `canvas_api_token` (required): Your Canvas personal access token.
- `mcp_auth_token` (optional): Bearer token required for `/mcp` requests if set.

The add-on maps these options to environment variables inside the container:
- `CANVAS_BASE_URL`
- `CANVAS_API_TOKEN`
- `MCP_AUTH_TOKEN`

## Usage
1. Start the add-on.
2. Access the MCP endpoint: `http://<home-assistant-host>:8080/mcp`
   - If `mcp_auth_token` is set, include the header: `Authorization: Bearer <token>`.
3. Health check: `http://<home-assistant-host>:8080/healthz` → returns `OK`.

## Notes
- Exposes port 8080; ensure your network/firewall allows access if needed.
- The server never logs secrets and is strictly read-only for Canvas (GET-only).
- For MCP client configuration (e.g., Claude Desktop), point to the `/mcp` URL above.
