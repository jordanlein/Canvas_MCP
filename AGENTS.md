# Development Guidelines for AI Assistants (Codex)

This document contains project-specific rules and guidelines for AI assistants (including Codex) working on the Canvas MCP server. It preserves the same rules defined in `CLAUDE.md` (read-only access, secure env-var configuration, minimal normalized outputs, thin-slice changes, and documentation updates) and adds one Codex-specific rule.

## Codex-Specific Rule

- Always show the workspace `/diff` (a clear diff of pending changes) before suggesting any `git commit` or `git push` action.
- Do not delete or rename `CLAUDE.md`.

## Core Principles

### 1. Read-Only Access Only
- This is a **read-only** Canvas MCP server
- **Never implement write endpoints** (no creating/updating/deleting courses, assignments, submissions, etc.)
- Only implement GET requests to Canvas API
- If asked to add write functionality, politely decline and explain this is intentionally read-only

### 2. Security & Configuration
- **Never log, print, or expose API tokens** in code, logs, or console output
- Configuration must **only** be via environment variables (`.env` file)
- **Never commit `.env` files** to git (already in `.gitignore`)
- Always use `.env.example` as the template for required config
- Validate required environment variables on startup and fail fast with clear error messages

### 3. Incremental Development (Thin-Slice)
- Implement tools **one at a time**, in this order:
  1. ✅ `list_courses` (completed)
  2. ✅ `list_assignments` (completed)
  3. ✅ `get_submission_status` (completed)
  4. ✅ `get_course_grades` (completed)
  5. Additional tools can be added after approval
- Build, test, and verify each tool before moving to the next
- Don't implement multiple tools in one go unless explicitly requested

### 4. Pagination
- All list endpoints (courses, assignments, etc.) **must handle pagination via Link headers**
- Parse the `Link` response header to extract `rel="next"` URLs
- Automatically fetch all pages until no `next` link exists
- Use `per_page=100` to minimize number of requests
- Never return partial/incomplete lists

### 5. Normalized Output
- Tool outputs must be **normalized and minimal by default**
- Don't return huge raw Canvas API payloads
- Extract only the essential fields users need:
  - IDs, names, titles, dates, scores, grades, status
  - Exclude verbose metadata, internal Canvas fields, large HTML descriptions (unless specifically needed)
- Keep JSON responses clean and readable
- Format dates consistently (ISO 8601)

### 6. Transport & Architecture
- **Streamable HTTP transport** (Server-Sent Events per MCP spec)
- Remote MCP server accessible via HTTP endpoints
- Default port: 8080 (configurable via `PORT` environment variable)
- Default MCP endpoint: `/mcp` (configurable via `BASE_PATH` environment variable)
- Health check endpoint: `/healthz` (returns 200 OK)
- Uses `SSEServerTransport` from MCP SDK for POST+GET pattern
- Listens on `0.0.0.0` to allow remote connections

### 6.1. Security
- **Origin validation**: Protects against unauthorized cross-origin requests
- **DNS rebinding protection**: Validates Host header to prevent DNS rebinding attacks
- Configurable via `ALLOWED_ORIGINS` environment variable (default: `http://localhost:*,http://127.0.0.1:*`)
- Supports wildcard port matching for development
- Allows localhost, private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x), and .local domains
- Rejects requests with invalid Host or Origin headers (403 Forbidden)

### 6.2. Docker Deployment
- Production Dockerfile included for containerized deployment
- Multi-stage build optimized for size
- ARM-compatible (node:20-alpine) for Raspberry Pi
- docker-compose.yml with `restart: unless-stopped`
- Runs as non-root user for security
- Includes health checks
- Environment variables: `CANVAS_BASE_URL`, `CANVAS_API_TOKEN`, `PORT`, `BASE_PATH`, `ALLOWED_ORIGINS`

### 7. Documentation
- **Update README.md** whenever:
  - Commands change (build, dev, start scripts)
  - Configuration requirements change
  - New tools are added
  - Setup instructions change
  - Claude Desktop or Codex config examples change
- Keep README accurate and user-friendly for non-technical users

## Implementation Patterns

### Canvas API Client
- Use **built-in `fetch`** (no axios unless there's a specific need)
- Centralize Canvas API calls in `canvas-client.ts`
- Handle errors gracefully with clear error messages
- Include proper Authorization headers: `Bearer ${token}`

### Error Handling
- Gracefully handle missing/unavailable data (especially grades)
- Return clear error messages to users
- Don't crash on API errors - return error state to MCP client
- Validate inputs before making API calls

### Filter Semantics
- Define exact, deterministic filtering behavior
- Handle null/missing fields gracefully
- Document semantics in code comments and tool descriptions
- Example (list_assignments status_filter):
  - `"all"`: No filtering (returns everything)
  - `"missing"`: `submission.missing === true` OR (due date passed AND no `submitted_at`)
  - `"unsubmitted"`: No submission object OR no `submitted_at` (regardless of due date)
  - `"submitted"`: `submitted_at` exists OR `workflow_state` indicates submission
- Best-effort filters (like `include_future` based on `unlock_at`) should be documented as such

### Code Style
- TypeScript strict mode
- Clear interfaces for Canvas API types
- Descriptive function and variable names
- Minimal comments (code should be self-documenting)
- Keep files focused and modular

## Testing

### Before Committing
1. Run `npm run build` - must succeed with no errors
2. Manual test with `npm run dev` and JSON-RPC requests
3. Verify normalized output format
4. Test pagination with courses/assignments that span multiple pages
5. Test error cases (invalid IDs, missing config, etc.)

### Integration Testing
- Test in Claude Desktop (and Codex) after each new tool
- Verify natural language queries work ("What courses am I in?")
- Check that responses are clear and actionable

## What Not to Do

❌ Don't add write/modify/delete operations
❌ Don't log or expose API tokens
❌ Don't implement multiple tools at once without testing
❌ Don't return raw Canvas API payloads without normalization
❌ Don't add HTTP servers or network listeners
❌ Don't forget to update documentation
❌ Don't skip pagination - always fetch all pages
❌ Don't add unnecessary dependencies

## Current Status

**Implemented:**
- ✅ `list_courses` - List all active courses
- ✅ `list_assignments` - List assignments for a course (with pagination, status filtering)
- ✅ `get_submission_status` - Check detailed submission for a specific assignment (single API request)
- ✅ `get_course_grades` - Get grade summary for a course (graceful degradation, best-effort, never throws)
- ✅ `list_upcoming` - List upcoming/overdue assignments across all active courses (reuses existing logic)

**Planned:**
- Additional tools can be added after approval
- All v1 core tools plus convenience tools are now implemented

