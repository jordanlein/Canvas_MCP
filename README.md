# Canvas MCP Server

Read-only **Remote MCP server** (Streamable HTTP transport) for querying Canvas LMS courses, assignments, and grades.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Canvas credentials:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add:
   - `CANVAS_BASE_URL`: Your Canvas instance URL (e.g., `https://yourschool.instructure.com`)
   - `CANVAS_API_TOKEN`: Your Canvas personal access token
   - `CANVAS_TIMEOUT_MS` (optional, default `15000`): Timeout in milliseconds for outbound Canvas API requests (connect + read)
   - `PORT` (optional, default `8080`): HTTP server port
   - `BASE_PATH` (optional, default `/mcp`): MCP endpoint path
   - `ALLOWED_ORIGINS` (optional): Comma-separated list of allowed origins for Origin validation (default: `http://localhost:*,http://127.0.0.1:*`)
   - `MCP_AUTH_TOKEN` (optional): If set, require `Authorization: Bearer <token>` on all `/mcp` requests (both GET and POST)

   **To get your API token:**
   - Log into Canvas
   - Go to Account → Settings
   - Scroll to "Approved Integrations"
   - Click "+ New Access Token"
   - Set purpose (e.g., "MCP Server"), leave expiry blank
   - Copy the token (you won't see it again!)

3. **Build the project:**
   ```bash
   npm run build
   ```

## Running the Server

**Start the HTTP server:**
```bash
npm run dev
```

The server will start on `http://0.0.0.0:8080` (or your configured PORT) with:
- MCP endpoint: `http://localhost:8080/mcp`
- Health check: `http://localhost:8080/healthz`

**Test health check:**
```bash
curl http://localhost:8080/healthz
```

Expected response: `OK`

**Note:** The MCP endpoint (`/mcp`) uses **Streamable HTTP transport** (Server-Sent Events) and should be accessed by MCP clients (like Claude Desktop), not directly via curl.

**Security & Ops Features:**
- Origin validation protects against unauthorized cross-origin requests
- DNS rebinding protection validates the Host header
- Supports localhost, private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x), and .local domains (mDNS)
- Configure allowed origins via `ALLOWED_ORIGINS` environment variable
- Outbound Canvas API timeouts via `CANVAS_TIMEOUT_MS` (default 15000ms)
- Structured per-request logging for every MCP tool call (never logs secrets)
 - Optional Bearer auth for `/mcp` endpoint using `MCP_AUTH_TOKEN`

**MCP Auth (optional):**
- If `MCP_AUTH_TOKEN` is set, all `/mcp` requests must include header: `Authorization: Bearer <token>`
- Auth is enforced after Host/Origin validation
- On missing/invalid token, server returns `401` with `{ "error": "unauthorized" }`
- The token is never logged

## Docker Deployment (Raspberry Pi / Production)

This project includes Docker support for production deployment on Raspberry Pi or any ARM/x64 system.

### Prerequisites
- Docker installed on your system
- Docker Compose installed

### Deployment Steps

1. **Clone the repository to your Raspberry Pi:**
   ```bash
   git clone <your-repo-url>
   cd Canvas_MCP
   ```

2. **Create `.env` file with your Canvas credentials:**
   ```bash
   cp .env.example .env
   nano .env
   ```

   Set your Canvas credentials:
   ```env
   CANVAS_BASE_URL=https://yourschool.instructure.com
   CANVAS_API_TOKEN=your_canvas_api_token_here
   # Optional: outbound Canvas API timeout (ms)
   CANVAS_TIMEOUT_MS=15000
   # Optional: require Bearer token auth for /mcp
   MCP_AUTH_TOKEN=choose-a-strong-token
   ```

3. **Build and start the container:**
   ```bash
   docker-compose up -d
   ```

4. **Verify the container is running:**
   ```bash
   docker-compose ps
   ```

5. **Check logs:**
   ```bash
   docker-compose logs -f
   ```

6. **Test the server:**
   ```bash
   curl http://localhost:8080/healthz
   ```

### Docker Compose Commands

**Start the server:**
```bash
docker-compose up -d
```

**Stop the server:**
```bash
docker-compose down
```

**Restart the server:**
```bash
docker-compose restart
```

**View logs:**
```bash
docker-compose logs -f canvas-mcp
```

**Rebuild after code changes:**
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Configuration

The container automatically:
- Restarts unless explicitly stopped (`restart: unless-stopped`)
- Exposes port 8080
- Includes health checks
- Runs as non-root user for security

To change the port, edit `docker-compose.yml`:
```yaml
ports:
  - "3000:8080"  # External:Internal
```

## Connecting to Claude Desktop

This is a **remote MCP server** using Streamable HTTP transport. Configure Claude Desktop to connect to the running server.

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "canvas": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

**For Raspberry Pi or remote servers:**
```json
{
  "mcpServers": {
    "canvas": {
      "url": "http://raspberrypi.local:8080/mcp"
    }
  }
}
```

Or use the IP address:
```json
{
  "mcpServers": {
    "canvas": {
      "url": "http://192.168.1.100:8080/mcp"
    }
  }
}
```

**Important:**
1. The server must be **running** before starting Claude Desktop
2. Start with Docker: `docker-compose up -d` or locally: `npm run dev`
3. Verify the server is running: `curl http://localhost:8080/healthz`
4. For remote connections, ensure port 8080 is accessible (firewall rules, etc.)

Restart Claude Desktop, then try:
- "What Canvas courses am I enrolled in?"
- "Show me assignments for [course name]"
- "What assignments am I missing?"
- "Check my submission status for [assignment name]"
- "What's my current grade in [course name]?"
- "What's due this week?"
- "Show me all overdue assignments"

## Current Features (v0.5)

### `list_courses`
List all active Canvas courses with course ID, name, and course code.

### `list_assignments`
List assignments for a specific course with details including:
- Assignment ID, name, due date
- Points possible, submission types
- Submission status (workflow state, submitted date, missing/late flags)

**Parameters:**
- `course_id` (required): The Canvas course ID
- `include_future` (optional, default `true`): Include locked/future assignments. Best-effort filter based on `unlock_at` field; assignments without `unlock_at` are always included.
- `status_filter` (optional, default `"all"`): Filter by submission status:
  - `"all"`: No filtering (returns all assignments)
  - `"missing"`: `submission.missing === true` OR (due date passed AND no `submitted_at`)
  - `"unsubmitted"`: No submission object OR no `submitted_at` exists (regardless of due date)
  - `"submitted"`: `submitted_at` exists OR `workflow_state` is `submitted`/`graded`

**Supports pagination** via Canvas Link headers.

### `get_submission_status`
Get detailed submission status for a specific assignment with a single API request.

**Returns:**
- `assignment_id`: The assignment ID
- `name`: Assignment name
- `workflow_state`: Current submission state (e.g., "unsubmitted", "submitted", "graded")
- `submitted_at`: Submission timestamp (ISO 8601, null if not submitted)
- `graded_at`: Grading timestamp (ISO 8601, null if not graded)
- `score`: Numeric score (null if not graded)
- `late`: Boolean flag indicating late submission
- `missing`: Boolean flag indicating missing assignment
- `excused`: Boolean flag indicating excused assignment

**Parameters:**
- `course_id` (required): The Canvas course ID
- `assignment_id` (required): The Canvas assignment ID

### `get_course_grades`
Get grade summary for a course with graceful degradation. Single API request, read-only, never throws. Handles multiple enrollments by preferring active, most current enrollment.

**Returns when grades are available:**
```json
{
  "course_id": 123456,
  "available": true,
  "current_score": 87.5,
  "current_grade": "B+",
  "final_score": 85.0,
  "final_grade": "B",
  "enrollment_state": "active",
  "term_id": 5678,
  "course_start_at": "2025-01-15T00:00:00Z",
  "course_end_at": "2025-05-15T00:00:00Z",
  "last_updated": null
}
```

**Returns when grades not yet posted:**
```json
{
  "course_id": 123456,
  "available": false,
  "reason": "no_grades_yet",
  "enrollment_state": "active",
  "term_id": 5678,
  "course_start_at": "2025-01-15T00:00:00Z",
  "course_end_at": "2025-05-15T00:00:00Z"
}
```

**Returns when grades are hidden or course not found:**
```json
{
  "course_id": 123456,
  "available": false,
  "reason": "hidden_or_unavailable"
}
```

**Parameters:**
- `course_id` (required): The Canvas course ID

**Behavior:**
- Handles multiple enrollments (e.g., retaking a course) by preferring `enrollment_state="active"` and the most current enrollment (by course end date or enrollment ID)
- Distinguishes between grades not yet posted (`no_grades_yet`) and grades hidden/unavailable (`hidden_or_unavailable`)
- Includes metadata for sanity-checking: `enrollment_state`, `term_id`, and course date range
- All grade fields (scores, grades) may be `null` if not provided by Canvas
- Never throws errors

### `list_upcoming`
List upcoming and/or overdue assignments across all active courses in a single consolidated view. Reuses existing `list_courses` and `list_assignments` logic.

**Example response:**
```json
[
  {
    "course_id": 123456,
    "course_name": "Introduction to Computer Science",
    "assignment_id": 789012,
    "name": "Homework 5",
    "due_at": "2025-01-12T23:59:00Z",
    "status": "unsubmitted",
    "points_possible": 100
  },
  {
    "course_id": 123456,
    "course_name": "Introduction to Computer Science",
    "assignment_id": 789013,
    "name": "Final Project",
    "due_at": "2025-01-20T23:59:00Z",
    "status": "submitted",
    "points_possible": 200
  }
]
```

**Parameters:**
- `days` (optional, default `14`): Number of days to look ahead for upcoming assignments
- `include_overdue` (optional, default `true`): Include overdue assignments
- `course_ids` (optional): Array of course IDs to filter. If not provided, checks all active courses.

**Behavior:**
- Returns assignments due within the next N days and optionally overdue assignments
- Sorted by due date ascending (overdue items appear first)
- Status is one of: `"submitted"`, `"unsubmitted"`, `"missing"`
- Skips assignments without due dates
- Gracefully handles errors on individual courses (continues with remaining courses)
