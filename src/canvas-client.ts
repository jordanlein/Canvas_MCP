/**
 * Canvas API Client with Link header pagination support
 */

export interface CanvasConfig {
  baseUrl: string;
  apiToken: string;
  timeoutMs?: number;
}

export class CanvasClient {
  private baseUrl: string;
  private apiToken: string;
  private timeoutMs: number;

  constructor(config: CanvasConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiToken = config.apiToken;
    this.timeoutMs = typeof config.timeoutMs === 'number' && isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? Math.floor(config.timeoutMs)
      : 15000; // sensible default: 15s
  }

  /**
   * Perform a fetch with connect+read timeout using AbortController
   */
  private async fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      return res;
    } catch (err: any) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        const e = new Error(`Canvas request timed out after ${this.timeoutMs}ms`);
        (e as any).code = 'timeout';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse Link header to extract pagination URLs
   * Format: <https://...>; rel="next", <https://...>; rel="first"
   */
  private parseLinkHeader(linkHeader: string | null): { next?: string } {
    if (!linkHeader) {
      return {};
    }

    const links: { next?: string } = {};
    const parts = linkHeader.split(',');

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        const [, url, rel] = match;
        if (rel === 'next') {
          links.next = url;
        }
      }
    }

    return links;
  }

  /**
   * Make a GET request to Canvas API with automatic pagination
   */
  private async getWithPagination<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
    const results: T[] = [];

    // Build initial URL
    const url = new URL(`${this.baseUrl}/api/v1${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    // Set per_page to 100 to minimize requests
    url.searchParams.append('per_page', '100');

    let nextUrl: string | undefined = url.toString();

    while (nextUrl) {
      const response = await this.fetchWithTimeout(nextUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const e = new Error(`Canvas API error: ${response.status} ${response.statusText}`);
        (e as any).code = 'canvas_api_error';
        throw e;
      }

      let data: T[];
      try {
        data = await response.json() as T[];
      } catch (e) {
        const err = new Error('Invalid Canvas API response');
        (err as any).code = 'invalid_response';
        throw err;
      }
      results.push(...data);

      // Check for next page in Link header
      const linkHeader = response.headers.get('Link');
      const links = this.parseLinkHeader(linkHeader);
      nextUrl = links.next;
    }

    return results;
  }

  /**
   * List all active courses for the authenticated user
   */
  async listCourses() {
    interface RawCourse {
      id: number;
      name: string;
      course_code: string;
      enrollment_state?: string;
      enrollments?: Array<{ type: string; enrollment_state: string }>;
      workflow_state?: string;
    }

    const courses = await this.getWithPagination<RawCourse>('/courses', {
      'enrollment_state': 'active',
      'include[]': 'enrollment_state',
    });

    // Normalize output - keep only essential fields
    return courses.map(course => ({
      id: course.id,
      name: course.name,
      course_code: course.course_code,
      enrollment_state: course.enrollment_state || 'active',
    }));
  }

  /**
   * List assignments for a course
   *
   * Status filter semantics:
   * - "missing": submission.missing === true, OR (due_at passed AND no submitted_at)
   * - "unsubmitted": no submission object OR no submitted_at exists (regardless of due date)
   * - "submitted": submitted_at exists OR workflow_state indicates submission
   * - "all": no filtering (returns all assignments)
   *
   * include_future behavior (best-effort):
   * - Filters by unlock_at if present; assignments without unlock_at are always included
   */
  async listAssignments(
    courseId: string | number,
    includeFuture: boolean = true,
    statusFilter: 'all' | 'missing' | 'unsubmitted' | 'submitted' = 'all'
  ) {
    interface RawSubmission {
      workflow_state: string;
      submitted_at?: string | null;
      missing?: boolean;
      late?: boolean;
    }

    interface RawAssignment {
      id: number;
      name: string;
      description?: string;
      due_at?: string | null;
      unlock_at?: string | null;
      lock_at?: string | null;
      points_possible?: number;
      submission_types?: string[];
      has_submitted_submissions?: boolean;
      submission?: RawSubmission;
    }

    const params: Record<string, string> = {
      'include[]': 'submission',
    };

    const assignments = await this.getWithPagination<RawAssignment>(
      `/courses/${courseId}/assignments`,
      params
    );

    // Filter and normalize
    let filtered = assignments;

    // Filter by future/past if include_future is false (best-effort based on unlock_at)
    if (!includeFuture) {
      const now = new Date();
      filtered = filtered.filter(a => {
        if (!a.unlock_at) return true;
        return new Date(a.unlock_at) <= now;
      });
    }

    // Filter by submission status with deterministic semantics
    if (statusFilter !== 'all') {
      const now = new Date();

      filtered = filtered.filter(a => {
        const submission = a.submission;
        const hasSubmittedAt = submission?.submitted_at !== null && submission?.submitted_at !== undefined;
        const isDueDatePassed = a.due_at ? new Date(a.due_at) < now : false;

        switch (statusFilter) {
          case 'missing':
            // Primary: submission.missing flag
            if (submission?.missing === true) {
              return true;
            }
            // Fallback: due date passed AND no submitted_at
            return isDueDatePassed && !hasSubmittedAt;

          case 'unsubmitted':
            // No submission object OR no submitted_at (regardless of due date)
            return !submission || !hasSubmittedAt;

          case 'submitted':
            // submitted_at exists OR workflow_state indicates submitted
            if (hasSubmittedAt) {
              return true;
            }
            if (submission?.workflow_state === 'submitted' || submission?.workflow_state === 'graded') {
              return true;
            }
            return false;

          default:
            return true;
        }
      });
    }

    // Normalize output - keep only essential fields
    return filtered.map(assignment => ({
      id: assignment.id,
      name: assignment.name,
      due_at: assignment.due_at,
      unlock_at: assignment.unlock_at,
      lock_at: assignment.lock_at,
      points_possible: assignment.points_possible || 0,
      submission_types: assignment.submission_types || [],
      submission_status: assignment.submission ? {
        workflow_state: assignment.submission.workflow_state,
        submitted_at: assignment.submission.submitted_at,
        missing: assignment.submission.missing || false,
        late: assignment.submission.late || false,
      } : null,
    }));
  }

  /**
   * Get submission status for a specific assignment
   * Uses single API request with include[]=assignment to get both submission and assignment details
   */
  async getSubmissionStatus(courseId: string | number, assignmentId: string | number) {
    interface RawAssignment {
      id: number;
      name: string;
    }

    interface RawSubmission {
      assignment_id: number;
      workflow_state: string;
      submitted_at?: string | null;
      graded_at?: string | null;
      score?: number | null;
      late?: boolean;
      missing?: boolean;
      excused?: boolean;
      assignment?: RawAssignment;
    }

    const url = `${this.baseUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self`;
    const params = new URLSearchParams({
      'include[]': 'assignment',
    });

    const response = await this.fetchWithTimeout(`${url}?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const e = new Error(`Canvas API error: ${response.status} ${response.statusText}`);
      (e as any).code = 'canvas_api_error';
      throw e;
    }

    let submission: RawSubmission;
    try {
      submission = await response.json() as RawSubmission;
    } catch (e) {
      const err = new Error('Invalid Canvas API response');
      (err as any).code = 'invalid_response';
      throw err;
    }

    // Normalize output - return only essential fields
    return {
      assignment_id: submission.assignment_id,
      name: submission.assignment?.name || null,
      workflow_state: submission.workflow_state,
      submitted_at: submission.submitted_at || null,
      graded_at: submission.graded_at || null,
      score: submission.score !== null && submission.score !== undefined ? submission.score : null,
      late: submission.late || false,
      missing: submission.missing || false,
      excused: submission.excused || false,
    };
  }

  /**
   * Get course grade summary for the authenticated user
   * Best-effort: returns available: false if grades are hidden/unavailable or no_grades_yet
   * Never throws on missing grade data
   * Handles multiple enrollments by preferring active, most current enrollment
   */
  async getCourseGrades(courseId: string | number) {
    interface RawTerm {
      id: number;
      name: string;
      start_at?: string | null;
      end_at?: string | null;
    }

    interface RawGrades {
      current_score?: number | null;
      current_grade?: string | null;
      final_score?: number | null;
      final_grade?: string | null;
    }

    interface RawCourse {
      start_at?: string | null;
      end_at?: string | null;
    }

    interface RawEnrollment {
      id: number;
      course_id: number;
      enrollment_state: string;
      grades?: RawGrades;
      computed_current_score?: number | null;
      computed_current_grade?: string | null;
      computed_final_score?: number | null;
      computed_final_grade?: string | null;
      enrollment_term_id?: number | null;
      course?: RawCourse;
    }

    try {
      // Fetch enrollments with term data - still a single API call
      const url = `${this.baseUrl}/api/v1/courses/${courseId}/enrollments`;
      const params = new URLSearchParams({
        'user_id': 'self',
        'type[]': 'StudentEnrollment',
      });

      const response = await this.fetchWithTimeout(`${url}?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        // Course not found or access denied - return unavailable
        return {
          course_id: Number(courseId),
          available: false,
          reason: 'hidden_or_unavailable',
        };
      }

      const enrollments = await response.json() as RawEnrollment[];

      // Filter to enrollments for this course
      const courseEnrollments = enrollments.filter(e => e.course_id === Number(courseId));

      if (courseEnrollments.length === 0) {
        return {
          course_id: Number(courseId),
          available: false,
          reason: 'hidden_or_unavailable',
        };
      }

      // Select the best enrollment: prefer active, then most current (by date or highest ID)
      const activeEnrollments = courseEnrollments.filter(e => e.enrollment_state === 'active');
      const candidateEnrollments = activeEnrollments.length > 0 ? activeEnrollments : courseEnrollments;

      // Sort by end_at (most recent first), then by ID (highest first)
      candidateEnrollments.sort((a, b) => {
        const aEndAt = a.course?.end_at;
        const bEndAt = b.course?.end_at;

        // If both have end dates, prefer the later one (more current)
        if (aEndAt && bEndAt) {
          return new Date(bEndAt).getTime() - new Date(aEndAt).getTime();
        }
        // If only one has end date, prefer the one without (likely current/future)
        if (aEndAt && !bEndAt) return 1;
        if (!aEndAt && bEndAt) return -1;

        // Fall back to enrollment ID (higher = more recent)
        return b.id - a.id;
      });

      const enrollment = candidateEnrollments[0];

      // Fetch term name if we have term_id (requires second API call, skip for now - best effort)
      // We'll just include the term_id in metadata
      const termId = enrollment.enrollment_term_id || null;

      // Check if grade data is available (grades object or computed fields)
      const grades = enrollment.grades;
      const hasGradeData =
        (grades && (
          grades.current_score !== null ||
          grades.current_grade !== null ||
          grades.final_score !== null ||
          grades.final_grade !== null
        )) ||
        enrollment.computed_current_score !== null ||
        enrollment.computed_current_grade !== null;

      if (!hasGradeData) {
        // Grades are not yet posted (distinguish from hidden)
        return {
          course_id: Number(courseId),
          available: false,
          reason: 'no_grades_yet',
          enrollment_state: enrollment.enrollment_state,
          term_id: termId,
          course_start_at: enrollment.course?.start_at || null,
          course_end_at: enrollment.course?.end_at || null,
        };
      }

      // Return normalized grade summary with metadata
      const currentScore = grades?.current_score ?? enrollment.computed_current_score ?? null;
      const currentGrade = grades?.current_grade ?? enrollment.computed_current_grade ?? null;

      return {
        course_id: Number(courseId),
        available: true,
        current_score: currentScore,
        current_grade: currentGrade,
        final_score: grades?.final_score ?? enrollment.computed_final_score ?? null,
        final_grade: grades?.final_grade ?? enrollment.computed_final_grade ?? null,
        enrollment_state: enrollment.enrollment_state,
        term_id: termId,
        course_start_at: enrollment.course?.start_at || null,
        course_end_at: enrollment.course?.end_at || null,
        last_updated: null, // Not provided by Canvas API in this endpoint
      };

    } catch (error: any) {
      // Network error or other failure - return unavailable gracefully
      if (error && error.code === 'timeout') {
        return {
          course_id: Number(courseId),
          available: false,
          reason: 'hidden_or_unavailable',
        };
      }
      return {
        course_id: Number(courseId),
        available: false,
        reason: 'hidden_or_unavailable',
      };
    }
  }

  /**
   * List upcoming assignments across active courses
   * Reuses listCourses and listAssignments logic
   */
  async listUpcoming(
    days: number = 14,
    includeOverdue: boolean = true,
    courseIds?: (string | number)[]
  ) {
    // Get active courses
    const courses = await this.listCourses();

    // Filter by course_ids if provided
    const targetCourses = courseIds
      ? courses.filter(c => courseIds.includes(c.id) || courseIds.includes(String(c.id)))
      : courses;

    const now = new Date();
    const futureLimit = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Collect assignments from all courses
    const allAssignments: Array<{
      course_id: number;
      course_name: string;
      assignment_id: number;
      name: string;
      due_at: string | null;
      status: 'submitted' | 'unsubmitted' | 'missing';
      points_possible: number;
    }> = [];

    for (const course of targetCourses) {
      try {
        // Get all assignments for this course (include_future=true, status_filter=all)
        const assignments = await this.listAssignments(course.id, true, 'all');

        for (const assignment of assignments) {
          if (!assignment.due_at) {
            // Skip assignments without due dates
            continue;
          }

          const dueDate = new Date(assignment.due_at);

          // Filter by date range
          const isOverdue = dueDate < now;
          const isUpcoming = dueDate >= now && dueDate <= futureLimit;

          if ((includeOverdue && isOverdue) || isUpcoming) {
            // Determine status from submission_status
            let status: 'submitted' | 'unsubmitted' | 'missing' = 'unsubmitted';
            if (assignment.submission_status) {
              if (assignment.submission_status.missing) {
                status = 'missing';
              } else if (assignment.submission_status.submitted_at) {
                status = 'submitted';
              }
            }

            allAssignments.push({
              course_id: course.id,
              course_name: course.name,
              assignment_id: assignment.id,
              name: assignment.name,
              due_at: assignment.due_at,
              status,
              points_possible: assignment.points_possible,
            });
          }
        }
      } catch (error) {
        // Skip courses that error (graceful degradation)
        continue;
      }
    }

    // Sort by due_at ascending (overdue first, then chronological)
    allAssignments.sort((a, b) => {
      const aDate = new Date(a.due_at!);
      const bDate = new Date(b.due_at!);
      return aDate.getTime() - bDate.getTime();
    });

    return allAssignments;
  }
}
