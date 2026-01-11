# Canvas MCP Server

Read-only MCP server for querying Canvas LMS courses, assignments, and grades.

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

## Local Testing

**Quick test (standalone):**
```bash
npm run dev
```

After running, type this JSON request and press Enter twice:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

You should see the available tools listed.

**Test list_courses:**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_courses","arguments":{}}}
```

**Test list_assignments** (replace `123456` with a real course ID from list_courses):
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_assignments","arguments":{"course_id":"123456"}}}
```

**Filter missing assignments:**
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_assignments","arguments":{"course_id":"123456","status_filter":"missing"}}}
```

**Get submission status** (replace with real course_id and assignment_id):
```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_submission_status","arguments":{"course_id":"123456","assignment_id":"789012"}}}
```

**Get course grades** (replace with real course_id):
```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_course_grades","arguments":{"course_id":"123456"}}}
```

**List upcoming assignments** (next 7 days, include overdue):
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_upcoming","arguments":{"days":7,"include_overdue":true}}}
```

## Connecting to Claude Desktop

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": [
        "/Users/jordanleinberger/Documents/Canvas_MCP/dist/index.js"
      ],
      "env": {
        "CANVAS_BASE_URL": "https://yourschool.instructure.com",
        "CANVAS_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

Or reference the `.env` file by setting `cwd`:
```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/Users/jordanleinberger/Documents/Canvas_MCP"
    }
  }
}
```

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
