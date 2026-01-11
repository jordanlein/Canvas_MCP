/**
 * MCP Tool definitions for Canvas API
 */

import { CanvasClient } from './canvas-client.js';

function makeError(code: string, message: string): Error {
  const err = new Error(message);
  (err as any).code = code;
  return err;
}

export const TOOLS = [
  {
    name: 'list_courses',
    description: 'List all active Canvas courses for the authenticated user. Returns course ID, name, course code, and enrollment state.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_assignments',
    description: 'List assignments for a specific Canvas course. Returns assignment details including ID, name, due date, points possible, submission types, and submission status. Supports filtering by future availability and submission status.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: ['string', 'number'],
          description: 'The Canvas course ID',
        },
        include_future: {
          type: 'boolean',
          description: 'Include future/locked assignments (default: true). Best-effort filter based on unlock_at field; assignments without unlock_at are always included.',
          default: true,
        },
        status_filter: {
          type: 'string',
          enum: ['all', 'missing', 'unsubmitted', 'submitted'],
          description: 'Filter by submission status. "missing": submission.missing===true OR (due_at passed AND no submitted_at). "unsubmitted": no submission OR no submitted_at (regardless of due date). "submitted": submitted_at exists OR workflow_state is submitted/graded. "all": no filtering (default).',
          default: 'all',
        },
      },
      required: ['course_id'],
    },
  },
  {
    name: 'get_submission_status',
    description: 'Get detailed submission status for a specific assignment. Returns assignment name, workflow state, submission/grading timestamps, score, and flags (late, missing, excused). Single API request.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: ['string', 'number'],
          description: 'The Canvas course ID',
        },
        assignment_id: {
          type: ['string', 'number'],
          description: 'The Canvas assignment ID',
        },
      },
      required: ['course_id', 'assignment_id'],
    },
  },
  {
    name: 'get_course_grades',
    description: 'Get grade summary for a course. Best-effort and read-only. Handles multiple enrollments by preferring active, most current enrollment. Returns available:false with reason "no_grades_yet" (grades not posted) or "hidden_or_unavailable" (access denied/hidden). Otherwise returns current/final scores/grades with enrollment metadata. Single API request, never throws.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: {
          type: ['string', 'number'],
          description: 'The Canvas course ID',
        },
      },
      required: ['course_id'],
    },
  },
  {
    name: 'list_upcoming',
    description: 'List upcoming/overdue assignments across active courses. Returns a consolidated list of assignments due within the next N days (default 14), optionally including overdue assignments. Reuses existing course and assignment queries. Sorted by due date (overdue first).',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look ahead for upcoming assignments (default: 14)',
          default: 14,
        },
        include_overdue: {
          type: 'boolean',
          description: 'Include overdue assignments (default: true)',
          default: true,
        },
        course_ids: {
          type: 'array',
          items: {
            type: ['string', 'number'],
          },
          description: 'Optional: filter to specific course IDs. If not provided, checks all active courses.',
        },
      },
      required: [],
    },
  },
] as const;

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  canvasClient: CanvasClient
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (toolName) {
    case 'list_courses': {
      const courses = await canvasClient.listCourses();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(courses, null, 2),
        }],
      };
    }

    case 'list_assignments': {
      const courseId = args.course_id as string | number;
      const includeFuture = args.include_future !== undefined ? args.include_future as boolean : true;
      const statusFilter = (args.status_filter as 'all' | 'missing' | 'unsubmitted' | 'submitted') || 'all';

      if (!courseId) {
        throw makeError('invalid_arguments', 'course_id is required');
      }

      const assignments = await canvasClient.listAssignments(courseId, includeFuture, statusFilter);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(assignments, null, 2),
        }],
      };
    }

    case 'get_submission_status': {
      const courseId = args.course_id as string | number;
      const assignmentId = args.assignment_id as string | number;

      if (!courseId) {
        throw makeError('invalid_arguments', 'course_id is required');
      }
      if (!assignmentId) {
        throw makeError('invalid_arguments', 'assignment_id is required');
      }

      const submission = await canvasClient.getSubmissionStatus(courseId, assignmentId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(submission, null, 2),
        }],
      };
    }

    case 'get_course_grades': {
      const courseId = args.course_id as string | number;

      if (!courseId) {
        throw makeError('invalid_arguments', 'course_id is required');
      }

      const grades = await canvasClient.getCourseGrades(courseId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(grades, null, 2),
        }],
      };
    }

    case 'list_upcoming': {
      const days = args.days !== undefined ? args.days as number : 14;
      const includeOverdue = args.include_overdue !== undefined ? args.include_overdue as boolean : true;
      const courseIds = args.course_ids as (string | number)[] | undefined;

      const upcoming = await canvasClient.listUpcoming(days, includeOverdue, courseIds);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(upcoming, null, 2),
        }],
      };
    }

    default:
      throw makeError('invalid_tool', `Unknown tool: ${toolName}`);
  }
}
