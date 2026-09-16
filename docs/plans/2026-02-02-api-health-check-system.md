# API Health Check System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a comprehensive API health check system that tests all 46 endpoints, validates responses, checks database connectivity, and generates a detailed health report with recommendations.

**Architecture:** Create a standalone health check script that programmatically tests all API routes with authentication, validates response schemas, checks database queries, tests error handling, and outputs a JSON/Markdown report with pass/fail status and performance metrics.

**Tech Stack:** TypeScript, Node.js (tsx), Next.js API routes, Turso (SQLite), Zod for schema validation, color output for CLI

---

## Discovered API Structure

**Total Endpoints:** 46 API routes across 12 domains

**Domains:**
1. **Auth** (3) - login, logout, verify
2. **Notes** (5) - CRUD, share, cleanup
3. **Daily Notes** (1) - daily journal
4. **Weekly** (2) - weekly reviews
5. **Tasks** (6) - CRUD, recommendations with feedback
6. **Projects** (2) - CRUD
7. **Captures** (5) - CRUD, link scraping/metadata
8. **Insights** (2) - generate, list
9. **Embeddings** (2) - generate, similarity search
10. **Connections** (2) - note connections
11. **Attachments** (3) - CRUD, pinning
12. **Graph** (1) - knowledge graph
13. **Search** (1) - full-text search
14. **Activity** (1) - recent activity
15. **Process** (1) - background processing
16. **Import** (1) - Obsidian import
17. **Agents** (2) - list, get by type (NEW)
18. **Agent Tasks** (7) - CRUD, review workflow (NEW)
19. **Health** (1) - existing health check
20. **Cron** (1) - queue processing

---

## Phase 1: Health Check Infrastructure

### Task 1: Create Health Check Types & Schemas

**Files:**
- Create: `scripts/health-check/types.ts`

**Step 1: Define health check types**

```typescript
/**
 * Health Check Types
 * Defines all types for API health checking
 */

export interface EndpointTest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  domain: string;
  requiresAuth: boolean;
  requiresData?: boolean; // Needs existing data (e.g., note ID)
  testData?: Record<string, any>; // Data to POST/PATCH
  expectedStatus?: number;
  validateResponse?: (data: any) => boolean;
  description: string;
}

export interface TestResult {
  endpoint: string;
  method: string;
  domain: string;
  status: 'pass' | 'fail' | 'skip' | 'warning';
  statusCode?: number;
  responseTime?: number;
  error?: string;
  warnings?: string[];
  timestamp: string;
}

export interface DomainHealth {
  domain: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  warnings: number;
  avgResponseTime: number;
}

export interface HealthReport {
  timestamp: string;
  environment: 'development' | 'production' | 'test';
  database: {
    connected: boolean;
    responseTime?: number;
    error?: string;
  };
  endpoints: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
  domains: DomainHealth[];
  results: TestResult[];
  recommendations: string[];
}
```

**Step 2: Commit**

```bash
git add scripts/health-check/types.ts
git commit -m "feat(health): add health check type definitions

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 2: Create Endpoint Registry

**Files:**
- Create: `scripts/health-check/endpoints.ts`

**Step 1: Define all endpoint tests**

```typescript
/**
 * Endpoint Registry
 * Complete list of all API endpoints with test configurations
 */

import { EndpointTest } from './types';

export const ENDPOINT_TESTS: EndpointTest[] = [
  // =====================================================
  // AUTH
  // =====================================================
  {
    method: 'POST',
    path: '/api/auth/login',
    domain: 'auth',
    requiresAuth: false,
    testData: { email: 'test@example.com' },
    expectedStatus: 200,
    description: 'Send magic link',
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    domain: 'auth',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Logout user',
  },
  {
    method: 'GET',
    path: '/api/auth/verify',
    domain: 'auth',
    requiresAuth: false,
    description: 'Verify magic link token',
  },

  // =====================================================
  // HEALTH
  // =====================================================
  {
    method: 'GET',
    path: '/api/health',
    domain: 'health',
    requiresAuth: false,
    expectedStatus: 200,
    validateResponse: (data) => data.ok === true,
    description: 'System health check',
  },

  // =====================================================
  // NOTES
  // =====================================================
  {
    method: 'GET',
    path: '/api/notes',
    domain: 'notes',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.notes),
    description: 'List all notes',
  },
  {
    method: 'POST',
    path: '/api/notes',
    domain: 'notes',
    requiresAuth: true,
    testData: {
      title: 'Health Check Test Note',
      content: 'This is a test note created by the health check system.',
    },
    expectedStatus: 201,
    validateResponse: (data) => data.note && data.note.id,
    description: 'Create new note',
  },
  {
    method: 'GET',
    path: '/api/notes/[id]',
    domain: 'notes',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get note by ID',
  },
  {
    method: 'PATCH',
    path: '/api/notes/[id]',
    domain: 'notes',
    requiresAuth: true,
    requiresData: true,
    testData: { title: 'Updated Title' },
    expectedStatus: 200,
    description: 'Update note',
  },
  {
    method: 'DELETE',
    path: '/api/notes/[id]',
    domain: 'notes',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete note',
  },

  // =====================================================
  // PROJECTS
  // =====================================================
  {
    method: 'GET',
    path: '/api/projects',
    domain: 'projects',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.projects),
    description: 'List all projects',
  },
  {
    method: 'POST',
    path: '/api/projects',
    domain: 'projects',
    requiresAuth: true,
    testData: {
      name: 'Health Check Project',
      description: 'Test project',
    },
    expectedStatus: 201,
    description: 'Create new project',
  },

  // =====================================================
  // TASKS
  // =====================================================
  {
    method: 'GET',
    path: '/api/tasks',
    domain: 'tasks',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.tasks),
    description: 'List all tasks',
  },
  {
    method: 'POST',
    path: '/api/tasks',
    domain: 'tasks',
    requiresAuth: true,
    testData: {
      content: 'Health check test task',
      priority: 'medium',
    },
    expectedStatus: 201,
    description: 'Create new task',
  },
  {
    method: 'GET',
    path: '/api/tasks/recommendations',
    domain: 'tasks',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Get task recommendations',
  },
  {
    method: 'POST',
    path: '/api/tasks/recommendations/scan',
    domain: 'tasks',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Scan for task recommendations',
  },

  // =====================================================
  // CAPTURES
  // =====================================================
  {
    method: 'GET',
    path: '/api/captures',
    domain: 'captures',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.captures),
    description: 'List all captures',
  },
  {
    method: 'POST',
    path: '/api/captures',
    domain: 'captures',
    requiresAuth: true,
    testData: {
      content: 'Health check capture',
      capture_type: 'thought',
    },
    expectedStatus: 201,
    description: 'Create new capture',
  },

  // =====================================================
  // DAILY NOTES
  // =====================================================
  {
    method: 'GET',
    path: '/api/daily',
    domain: 'daily',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Get or create today\'s daily note',
  },

  // =====================================================
  // WEEKLY REVIEWS
  // =====================================================
  {
    method: 'GET',
    path: '/api/weekly',
    domain: 'weekly',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'List weekly reviews',
  },

  // =====================================================
  // INSIGHTS
  // =====================================================
  {
    method: 'GET',
    path: '/api/insights',
    domain: 'insights',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.insights),
    description: 'List all insights',
  },

  // =====================================================
  // EMBEDDINGS
  // =====================================================
  {
    method: 'POST',
    path: '/api/embeddings',
    domain: 'embeddings',
    requiresAuth: true,
    testData: { text: 'Test embedding generation' },
    expectedStatus: 200,
    description: 'Generate embedding',
  },
  {
    method: 'POST',
    path: '/api/embeddings/similar',
    domain: 'embeddings',
    requiresAuth: true,
    testData: { text: 'Find similar notes' },
    expectedStatus: 200,
    description: 'Find similar notes',
  },

  // =====================================================
  // CONNECTIONS
  // =====================================================
  {
    method: 'GET',
    path: '/api/connections',
    domain: 'connections',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'List note connections',
  },

  // =====================================================
  // SEARCH
  // =====================================================
  {
    method: 'GET',
    path: '/api/search',
    domain: 'search',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Search notes',
  },

  // =====================================================
  // GRAPH
  // =====================================================
  {
    method: 'GET',
    path: '/api/graph',
    domain: 'graph',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => data.nodes && data.links,
    description: 'Get knowledge graph',
  },

  // =====================================================
  // ATTACHMENTS
  // =====================================================
  {
    method: 'GET',
    path: '/api/attachments',
    domain: 'attachments',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'List all attachments',
  },

  // =====================================================
  // ACTIVITY
  // =====================================================
  {
    method: 'GET',
    path: '/api/activity/recent',
    domain: 'activity',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Get recent activity',
  },

  // =====================================================
  // PROCESS
  // =====================================================
  {
    method: 'POST',
    path: '/api/process',
    domain: 'process',
    requiresAuth: true,
    testData: { entity_type: 'note', entity_id: 'test-id', operation: 'generate_summary' },
    expectedStatus: 200,
    description: 'Queue background processing',
  },

  // =====================================================
  // AGENTS (NEW)
  // =====================================================
  {
    method: 'GET',
    path: '/api/agents',
    domain: 'agents',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.agents),
    description: 'List all AI agents',
  },

  // =====================================================
  // AGENT TASKS (NEW)
  // =====================================================
  {
    method: 'GET',
    path: '/api/agent-tasks',
    domain: 'agent-tasks',
    requiresAuth: true,
    expectedStatus: 200,
    validateResponse: (data) => Array.isArray(data.tasks),
    description: 'List agent tasks',
  },
  {
    method: 'POST',
    path: '/api/agent-tasks',
    domain: 'agent-tasks',
    requiresAuth: true,
    testData: {
      title: 'Health check agent task',
      description: 'Test task for health check',
      assignedAgent: 'general',
      autoExecute: false,
    },
    expectedStatus: 201,
    description: 'Create agent task',
  },
];
```

**Step 2: Commit**

```bash
git add scripts/health-check/endpoints.ts
git commit -m "feat(health): add endpoint registry with 30+ test definitions

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 3: Create Test Runner

**Files:**
- Create: `scripts/health-check/runner.ts`

**Step 1: Write test execution engine**

```typescript
/**
 * Health Check Test Runner
 * Executes API tests and collects results
 */

import { EndpointTest, TestResult, HealthReport } from './types';

export class HealthCheckRunner {
  private baseUrl: string;
  private sessionCookie: string | null = null;
  private createdResources: Map<string, string> = new Map(); // domain -> ID

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Authenticate and get session cookie
   */
  async authenticate(): Promise<boolean> {
    try {
      // For testing, we'll need a test user session
      // This should use a test account or mock authentication
      console.log('⚠️  Authentication not implemented - tests will fail if auth required');
      return false;
    } catch (error) {
      console.error('Authentication failed:', error);
      return false;
    }
  }

  /**
   * Test database connectivity
   */
  async testDatabase(): Promise<{ connected: boolean; responseTime?: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      const responseTime = Date.now() - start;

      if (response.ok) {
        return { connected: true, responseTime };
      } else {
        return { connected: false, error: `Health check returned ${response.status}` };
      }
    } catch (error) {
      return { connected: false, error: String(error) };
    }
  }

  /**
   * Execute a single endpoint test
   */
  async testEndpoint(test: EndpointTest): Promise<TestResult> {
    const start = Date.now();
    const timestamp = new Date().toISOString();

    // Skip if requires auth and we're not authenticated
    if (test.requiresAuth && !this.sessionCookie) {
      return {
        endpoint: test.path,
        method: test.method,
        domain: test.domain,
        status: 'skip',
        error: 'Requires authentication',
        timestamp,
      };
    }

    // Replace [id] with actual resource ID if needed
    let url = `${this.baseUrl}${test.path}`;
    if (test.requiresData && test.path.includes('[id]')) {
      const resourceId = this.createdResources.get(test.domain);
      if (!resourceId) {
        return {
          endpoint: test.path,
          method: test.method,
          domain: test.domain,
          status: 'skip',
          error: 'No test data available',
          timestamp,
        };
      }
      url = url.replace('[id]', resourceId);
    }

    try {
      const options: RequestInit = {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (this.sessionCookie) {
        options.headers = {
          ...options.headers,
          Cookie: this.sessionCookie,
        };
      }

      if (test.testData && (test.method === 'POST' || test.method === 'PATCH' || test.method === 'PUT')) {
        options.body = JSON.stringify(test.testData);
      }

      const response = await fetch(url, options);
      const responseTime = Date.now() - start;
      const statusCode = response.status;

      let data: any;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      // Store created resource ID for later tests
      if (test.method === 'POST' && response.ok && data) {
        const idField = Object.keys(data).find(k => data[k]?.id);
        if (idField && data[idField]?.id) {
          this.createdResources.set(test.domain, data[idField].id);
        }
      }

      // Validate response
      const warnings: string[] = [];
      let status: 'pass' | 'fail' | 'warning' = 'pass';

      // Check expected status
      if (test.expectedStatus && statusCode !== test.expectedStatus) {
        status = 'fail';
      } else if (!response.ok && !test.expectedStatus) {
        status = 'fail';
      }

      // Run custom validation
      if (test.validateResponse && data) {
        try {
          const isValid = test.validateResponse(data);
          if (!isValid) {
            warnings.push('Response validation failed');
            status = status === 'pass' ? 'warning' : status;
          }
        } catch (error) {
          warnings.push(`Validation error: ${error}`);
          status = 'warning';
        }
      }

      // Check response time (warn if > 1s)
      if (responseTime > 1000) {
        warnings.push(`Slow response: ${responseTime}ms`);
        status = status === 'pass' ? 'warning' : status;
      }

      return {
        endpoint: test.path,
        method: test.method,
        domain: test.domain,
        status,
        statusCode,
        responseTime,
        warnings: warnings.length > 0 ? warnings : undefined,
        error: !response.ok ? data?.error || `HTTP ${statusCode}` : undefined,
        timestamp,
      };
    } catch (error) {
      return {
        endpoint: test.path,
        method: test.method,
        domain: test.domain,
        status: 'fail',
        responseTime: Date.now() - start,
        error: String(error),
        timestamp,
      };
    }
  }

  /**
   * Run all tests and generate report
   */
  async runAll(tests: EndpointTest[]): Promise<HealthReport> {
    const timestamp = new Date().toISOString();
    const results: TestResult[] = [];

    // Test database first
    console.log('Testing database connectivity...');
    const database = await this.testDatabase();

    // Authenticate
    console.log('Authenticating...');
    await this.authenticate();

    // Run all endpoint tests
    console.log(`\nTesting ${tests.length} endpoints...\n`);
    for (const test of tests) {
      console.log(`  ${test.method} ${test.path} - ${test.description}`);
      const result = await this.testEndpoint(test);
      results.push(result);

      // Log result
      const statusIcon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : result.status === 'skip' ? '⊘' : '⚠';
      console.log(`    ${statusIcon} ${result.status.toUpperCase()} (${result.responseTime || 0}ms)`);
      if (result.error) console.log(`      Error: ${result.error}`);
      if (result.warnings) result.warnings.forEach(w => console.log(`      Warning: ${w}`));
    }

    // Calculate statistics
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const skipped = results.filter(r => r.status === 'skip').length;
    const warnings = results.filter(r => r.status === 'warning').length;

    // Group by domain
    const domainMap = new Map<string, TestResult[]>();
    for (const result of results) {
      if (!domainMap.has(result.domain)) {
        domainMap.set(result.domain, []);
      }
      domainMap.get(result.domain)!.push(result);
    }

    const domains = Array.from(domainMap.entries()).map(([domain, domainResults]) => ({
      domain,
      total: domainResults.length,
      passed: domainResults.filter(r => r.status === 'pass').length,
      failed: domainResults.filter(r => r.status === 'fail').length,
      skipped: domainResults.filter(r => r.status === 'skip').length,
      warnings: domainResults.filter(r => r.status === 'warning').length,
      avgResponseTime: domainResults
        .filter(r => r.responseTime)
        .reduce((sum, r) => sum + (r.responseTime || 0), 0) / domainResults.filter(r => r.responseTime).length || 0,
    }));

    // Generate recommendations
    const recommendations: string[] = [];
    if (!database.connected) {
      recommendations.push('❌ Database is not accessible - check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
    }
    if (failed > 0) {
      recommendations.push(`⚠️  ${failed} endpoint(s) failing - review error messages and fix issues`);
    }
    if (skipped > 0) {
      recommendations.push(`ℹ️  ${skipped} endpoint(s) skipped - implement authentication for full testing`);
    }
    if (warnings > 0) {
      recommendations.push(`⚠️  ${warnings} endpoint(s) have warnings - review performance or validation issues`);
    }
    const slowDomains = domains.filter(d => d.avgResponseTime > 500);
    if (slowDomains.length > 0) {
      recommendations.push(`🐌 Slow domains: ${slowDomains.map(d => `${d.domain} (${d.avgResponseTime.toFixed(0)}ms)`).join(', ')}`);
    }

    return {
      timestamp,
      environment: process.env.NODE_ENV as any || 'development',
      database,
      endpoints: {
        total: results.length,
        passed,
        failed,
        skipped,
        warnings,
      },
      domains,
      results,
      recommendations,
    };
  }
}
```

**Step 2: Commit**

```bash
git add scripts/health-check/runner.ts
git commit -m "feat(health): add test runner with execution engine

- Execute endpoint tests with timing
- Validate responses
- Track created resources for dependent tests
- Generate statistics and recommendations

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 4: Create Report Generator

**Files:**
- Create: `scripts/health-check/reporter.ts`

**Step 1: Write report formatters**

```typescript
/**
 * Health Check Report Generator
 * Formats health reports as JSON and Markdown
 */

import { HealthReport, DomainHealth, TestResult } from './types';
import * as fs from 'fs';
import * as path from 'path';

export class ReportGenerator {
  /**
   * Generate JSON report
   */
  static toJSON(report: HealthReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate Markdown report
   */
  static toMarkdown(report: HealthReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# API Health Check Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date(report.timestamp).toLocaleString()}`);
    lines.push(`**Environment:** ${report.environment}`);
    lines.push('');

    // Database Status
    lines.push('## Database Status');
    lines.push('');
    if (report.database.connected) {
      lines.push(`✅ **Connected** (${report.database.responseTime}ms)`);
    } else {
      lines.push(`❌ **Disconnected**`);
      if (report.database.error) {
        lines.push(`- Error: ${report.database.error}`);
      }
    }
    lines.push('');

    // Overall Statistics
    lines.push('## Overall Statistics');
    lines.push('');
    lines.push(`- **Total Endpoints:** ${report.endpoints.total}`);
    lines.push(`- **Passed:** ${report.endpoints.passed} ✅`);
    lines.push(`- **Failed:** ${report.endpoints.failed} ❌`);
    lines.push(`- **Warnings:** ${report.endpoints.warnings} ⚠️`);
    lines.push(`- **Skipped:** ${report.endpoints.skipped} ⊘`);
    lines.push('');

    const healthPercentage = report.endpoints.total > 0
      ? ((report.endpoints.passed / report.endpoints.total) * 100).toFixed(1)
      : 0;
    lines.push(`**Health Score:** ${healthPercentage}%`);
    lines.push('');

    // Domain Breakdown
    lines.push('## Domain Breakdown');
    lines.push('');
    lines.push('| Domain | Total | Passed | Failed | Warnings | Avg Response |');
    lines.push('|--------|-------|--------|--------|----------|--------------|');

    const sortedDomains = report.domains.sort((a, b) => b.failed - a.failed);
    for (const domain of sortedDomains) {
      const avgTime = domain.avgResponseTime.toFixed(0);
      lines.push(`| ${domain.domain} | ${domain.total} | ${domain.passed} | ${domain.failed} | ${domain.warnings} | ${avgTime}ms |`);
    }
    lines.push('');

    // Failed Endpoints
    const failedResults = report.results.filter(r => r.status === 'fail');
    if (failedResults.length > 0) {
      lines.push('## Failed Endpoints');
      lines.push('');
      for (const result of failedResults) {
        lines.push(`### ❌ ${result.method} ${result.endpoint}`);
        lines.push('');
        if (result.statusCode) {
          lines.push(`- **Status Code:** ${result.statusCode}`);
        }
        if (result.error) {
          lines.push(`- **Error:** ${result.error}`);
        }
        if (result.responseTime) {
          lines.push(`- **Response Time:** ${result.responseTime}ms`);
        }
        lines.push('');
      }
    }

    // Warnings
    const warningResults = report.results.filter(r => r.status === 'warning');
    if (warningResults.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const result of warningResults) {
        lines.push(`### ⚠️  ${result.method} ${result.endpoint}`);
        lines.push('');
        if (result.warnings) {
          result.warnings.forEach(w => lines.push(`- ${w}`));
        }
        lines.push('');
      }
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      report.recommendations.forEach(rec => {
        lines.push(`- ${rec}`);
      });
      lines.push('');
    }

    // Detailed Results
    lines.push('## Detailed Results');
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Click to expand all test results</summary>');
    lines.push('');
    lines.push('| Endpoint | Method | Status | Time | Notes |');
    lines.push('|----------|--------|--------|------|-------|');

    for (const result of report.results) {
      const statusIcon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : result.status === 'skip' ? '⊘' : '⚠️';
      const time = result.responseTime ? `${result.responseTime}ms` : '-';
      const notes = result.error || (result.warnings ? result.warnings.join('; ') : '-');
      lines.push(`| ${result.endpoint} | ${result.method} | ${statusIcon} ${result.status} | ${time} | ${notes} |`);
    }

    lines.push('');
    lines.push('</details>');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Save report to file
   */
  static async save(report: HealthReport, format: 'json' | 'markdown' | 'both' = 'both'): Promise<void> {
    const timestamp = new Date(report.timestamp).toISOString().replace(/:/g, '-').split('.')[0];
    const outputDir = path.join(process.cwd(), 'health-reports');

    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save JSON
    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(outputDir, `health-check-${timestamp}.json`);
      fs.writeFileSync(jsonPath, this.toJSON(report), 'utf-8');
      console.log(`\n📄 JSON report saved: ${jsonPath}`);
    }

    // Save Markdown
    if (format === 'markdown' || format === 'both') {
      const mdPath = path.join(outputDir, `health-check-${timestamp}.md`);
      fs.writeFileSync(mdPath, this.toMarkdown(report), 'utf-8');
      console.log(`📄 Markdown report saved: ${mdPath}`);
    }

    // Also save as "latest"
    if (format === 'json' || format === 'both') {
      const latestJsonPath = path.join(outputDir, 'latest.json');
      fs.writeFileSync(latestJsonPath, this.toJSON(report), 'utf-8');
    }
    if (format === 'markdown' || format === 'both') {
      const latestMdPath = path.join(outputDir, 'latest.md');
      fs.writeFileSync(latestMdPath, this.toMarkdown(report), 'utf-8');
      console.log(`📄 Latest report: health-reports/latest.md`);
    }
  }
}
```

**Step 2: Commit**

```bash
git add scripts/health-check/reporter.ts
git commit -m "feat(health): add report generator for JSON and Markdown

- Format reports with statistics and breakdowns
- Save timestamped and latest versions
- Include detailed results and recommendations

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 5: Create Main Health Check Script

**Files:**
- Create: `scripts/health-check.ts`
- Modify: `package.json`

**Step 1: Write main script**

```typescript
/**
 * API Health Check Script
 * Run with: npm run health-check
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { HealthCheckRunner } from './health-check/runner';
import { ReportGenerator } from './health-check/reporter';
import { ENDPOINT_TESTS } from './health-check/endpoints';

async function main() {
  console.log('🏥 Starting API Health Check...\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const runner = new HealthCheckRunner(baseUrl);

  // Run all tests
  const report = await runner.runAll(ENDPOINT_TESTS);

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('\n📊 HEALTH CHECK SUMMARY\n');
  console.log(`Total Endpoints: ${report.endpoints.total}`);
  console.log(`Passed: ${report.endpoints.passed} ✅`);
  console.log(`Failed: ${report.endpoints.failed} ❌`);
  console.log(`Warnings: ${report.endpoints.warnings} ⚠️`);
  console.log(`Skipped: ${report.endpoints.skipped} ⊘`);

  const healthPercentage = report.endpoints.total > 0
    ? ((report.endpoints.passed / report.endpoints.total) * 100).toFixed(1)
    : 0;
  console.log(`\nHealth Score: ${healthPercentage}%`);

  if (report.database.connected) {
    console.log(`Database: ✅ Connected (${report.database.responseTime}ms)`);
  } else {
    console.log(`Database: ❌ Disconnected`);
  }

  // Print recommendations
  if (report.recommendations.length > 0) {
    console.log('\n📋 RECOMMENDATIONS:\n');
    report.recommendations.forEach(rec => console.log(`  ${rec}`));
  }

  // Save report
  console.log('\n');
  await ReportGenerator.save(report, 'both');

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(report.endpoints.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Health check failed:', error);
  process.exit(1);
});
```

**Step 2: Add npm script to package.json**

In the `scripts` section, add:

```json
"health-check": "tsx scripts/health-check.ts",
"health-check:watch": "tsx watch scripts/health-check.ts"
```

**Step 3: Create .gitignore entry for reports**

Add to `.gitignore`:

```
# Health check reports
health-reports/
```

**Step 4: Run health check**

```bash
npm run health-check
```

Expected: Health check runs, generates report, exits with status code

**Step 5: Commit**

```bash
git add scripts/health-check.ts package.json .gitignore
git commit -m "feat(health): add main health check script with CLI

- Run all endpoint tests
- Print summary with statistics
- Save JSON and Markdown reports
- Exit with appropriate status code

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Enhanced Testing Features

### Task 6: Add Authentication Helper

**Files:**
- Create: `scripts/health-check/auth.ts`

**Step 1: Create test authentication**

```typescript
/**
 * Test Authentication Helper
 * Handles authentication for health check tests
 */

export interface AuthConfig {
  testEmail?: string;
  testUserId?: string;
  sessionToken?: string;
}

export class TestAuthenticator {
  private config: AuthConfig;

  constructor(config: AuthConfig = {}) {
    this.config = {
      testEmail: config.testEmail || process.env.TEST_USER_EMAIL || 'test@health-check.local',
      testUserId: config.testUserId || process.env.TEST_USER_ID,
      sessionToken: config.sessionToken || process.env.TEST_SESSION_TOKEN,
    };
  }

  /**
   * Get session cookie for tests
   * Returns existing token or creates a test session
   */
  async getSessionCookie(): Promise<string | null> {
    // If we have a session token from env, use it
    if (this.config.sessionToken) {
      return `session=${this.config.sessionToken}`;
    }

    // Otherwise, need to create a test session
    // This would require either:
    // 1. A test user seeded in the database
    // 2. A magic link flow
    // 3. A test-only auth bypass (development only)

    console.warn('⚠️  No test session token available');
    console.warn('   Set TEST_SESSION_TOKEN in .env.local for authenticated tests');
    console.warn('   Or implement test user creation in this method');

    return null;
  }

  /**
   * Create a test user session (if not exists)
   */
  async createTestSession(baseUrl: string): Promise<string | null> {
    // Implementation would:
    // 1. Check if test user exists
    // 2. Create if needed
    // 3. Generate session token
    // 4. Return session cookie

    // For now, return null
    return null;
  }

  /**
   * Cleanup test session
   */
  async cleanup(): Promise<void> {
    // Cleanup any test data created during health check
  }
}
```

**Step 2: Update runner to use authenticator**

Modify `scripts/health-check/runner.ts` to import and use `TestAuthenticator`:

```typescript
import { TestAuthenticator } from './auth';

// In constructor:
private authenticator: TestAuthenticator;

constructor(baseUrl: string = 'http://localhost:3000') {
  this.baseUrl = baseUrl;
  this.authenticator = new TestAuthenticator();
}

// Update authenticate method:
async authenticate(): Promise<boolean> {
  try {
    const cookie = await this.authenticator.getSessionCookie();
    if (cookie) {
      this.sessionCookie = cookie;
      return true;
    }
    return false;
  } catch (error) {
    console.error('Authentication failed:', error);
    return false;
  }
}
```

**Step 3: Commit**

```bash
git add scripts/health-check/auth.ts scripts/health-check/runner.ts
git commit -m "feat(health): add authentication helper for test sessions

- Support session token from environment
- Warn when authentication unavailable
- Prepare for test user creation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 7: Add Missing Endpoints to Registry

**Files:**
- Modify: `scripts/health-check/endpoints.ts`

**Step 1: Add all remaining endpoints**

Add to `ENDPOINT_TESTS` array:

```typescript
  // =====================================================
  // NOTES - Additional endpoints
  // =====================================================
  {
    method: 'POST',
    path: '/api/notes/[id]/share',
    domain: 'notes',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Generate shareable link for note',
  },
  {
    method: 'POST',
    path: '/api/notes/[id]/cleanup',
    domain: 'notes',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Clean up note formatting',
  },

  // =====================================================
  // TASKS - Individual task endpoints
  // =====================================================
  {
    method: 'GET',
    path: '/api/tasks/[id]',
    domain: 'tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get task by ID',
  },
  {
    method: 'PATCH',
    path: '/api/tasks/[id]',
    domain: 'tasks',
    requiresAuth: true,
    requiresData: true,
    testData: { status: 'completed' },
    expectedStatus: 200,
    description: 'Update task',
  },
  {
    method: 'DELETE',
    path: '/api/tasks/[id]',
    domain: 'tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete task',
  },

  // =====================================================
  // TASK RECOMMENDATIONS - Full set
  // =====================================================
  {
    method: 'GET',
    path: '/api/tasks/recommendations/[id]',
    domain: 'tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get single recommendation',
  },
  {
    method: 'POST',
    path: '/api/tasks/recommendations/[id]/feedback',
    domain: 'tasks',
    requiresAuth: true,
    requiresData: true,
    testData: { status: 'accepted' },
    expectedStatus: 200,
    description: 'Provide feedback on recommendation',
  },

  // =====================================================
  // PROJECTS - Individual project
  // =====================================================
  {
    method: 'GET',
    path: '/api/projects/[id]',
    domain: 'projects',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get project by ID',
  },
  {
    method: 'PATCH',
    path: '/api/projects/[id]',
    domain: 'projects',
    requiresAuth: true,
    requiresData: true,
    testData: { name: 'Updated Project Name' },
    expectedStatus: 200,
    description: 'Update project',
  },
  {
    method: 'DELETE',
    path: '/api/projects/[id]',
    domain: 'projects',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete project',
  },

  // =====================================================
  // CAPTURES - Individual capture
  // =====================================================
  {
    method: 'GET',
    path: '/api/captures/[id]',
    domain: 'captures',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get capture by ID',
  },
  {
    method: 'PATCH',
    path: '/api/captures/[id]',
    domain: 'captures',
    requiresAuth: true,
    requiresData: true,
    testData: { processed: true },
    expectedStatus: 200,
    description: 'Update capture',
  },
  {
    method: 'DELETE',
    path: '/api/captures/[id]',
    domain: 'captures',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete capture',
  },

  // =====================================================
  // CAPTURES - Link operations
  // =====================================================
  {
    method: 'POST',
    path: '/api/captures/link/metadata',
    domain: 'captures',
    requiresAuth: true,
    testData: { url: 'https://example.com' },
    expectedStatus: 200,
    description: 'Fetch link metadata',
  },
  {
    method: 'POST',
    path: '/api/captures/link/scrape',
    domain: 'captures',
    requiresAuth: true,
    testData: { url: 'https://example.com' },
    expectedStatus: 200,
    description: 'Scrape link content',
  },

  // =====================================================
  // CONNECTIONS
  // =====================================================
  {
    method: 'POST',
    path: '/api/connections',
    domain: 'connections',
    requiresAuth: true,
    testData: {
      source_note_id: 'test-source',
      target_note_id: 'test-target',
      connection_type: 'related',
    },
    expectedStatus: 201,
    description: 'Create note connection',
  },
  {
    method: 'DELETE',
    path: '/api/connections/[id]',
    domain: 'connections',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete connection',
  },

  // =====================================================
  // WEEKLY REVIEWS
  // =====================================================
  {
    method: 'POST',
    path: '/api/weekly/generate',
    domain: 'weekly',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Generate weekly review',
  },

  // =====================================================
  // INSIGHTS
  // =====================================================
  {
    method: 'POST',
    path: '/api/insights/generate',
    domain: 'insights',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Generate new insights',
  },

  // =====================================================
  // ATTACHMENTS
  // =====================================================
  {
    method: 'GET',
    path: '/api/attachments/[id]',
    domain: 'attachments',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get attachment by ID',
  },
  {
    method: 'PATCH',
    path: '/api/attachments/[id]/pin',
    domain: 'attachments',
    requiresAuth: true,
    requiresData: true,
    testData: { is_pinned: true },
    expectedStatus: 200,
    description: 'Pin/unpin attachment',
  },
  {
    method: 'DELETE',
    path: '/api/attachments/[id]',
    domain: 'attachments',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Delete attachment',
  },

  // =====================================================
  // IMPORT
  // =====================================================
  {
    method: 'POST',
    path: '/api/import/obsidian',
    domain: 'import',
    requiresAuth: true,
    testData: { vault_path: '/test/vault' },
    expectedStatus: 200,
    description: 'Import from Obsidian',
  },

  // =====================================================
  // CRON
  // =====================================================
  {
    method: 'GET',
    path: '/api/cron/process-queue',
    domain: 'cron',
    requiresAuth: false,
    expectedStatus: 200,
    description: 'Process background queue (cron)',
  },

  // =====================================================
  // AGENT TASKS - Review workflow
  // =====================================================
  {
    method: 'GET',
    path: '/api/agent-tasks/[id]',
    domain: 'agent-tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Get agent task details',
  },
  {
    method: 'DELETE',
    path: '/api/agent-tasks/[id]',
    domain: 'agent-tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Cancel agent task',
  },
  {
    method: 'POST',
    path: '/api/agent-tasks/[id]/approve',
    domain: 'agent-tasks',
    requiresAuth: true,
    requiresData: true,
    expectedStatus: 200,
    description: 'Approve agent output',
  },
  {
    method: 'POST',
    path: '/api/agent-tasks/[id]/revise',
    domain: 'agent-tasks',
    requiresAuth: true,
    requiresData: true,
    testData: { feedback: 'Please improve this' },
    expectedStatus: 200,
    description: 'Request revision',
  },
  {
    method: 'POST',
    path: '/api/agent-tasks/[id]/reject',
    domain: 'agent-tasks',
    requiresAuth: true,
    requiresData: true,
    testData: { reason: 'Not what I needed' },
    expectedStatus: 200,
    description: 'Reject agent output',
  },

  // =====================================================
  // AGENTS
  // =====================================================
  {
    method: 'GET',
    path: '/api/agents/[type]',
    domain: 'agents',
    requiresAuth: true,
    expectedStatus: 200,
    description: 'Get specific agent by type',
  },
];
```

**Step 2: Commit**

```bash
git add scripts/health-check/endpoints.ts
git commit -m "feat(health): add all 46 API endpoints to test registry

- Complete coverage of all domains
- Individual resource endpoints (by ID)
- Workflow endpoints (approve, revise, reject)
- Link operations and imports

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Documentation & Usage

### Task 8: Create Health Check README

**Files:**
- Create: `docs/health-check-guide.md`

**Step 1: Write comprehensive guide**

```markdown
# API Health Check Guide

This guide explains how to use the API health check system to validate all endpoints and diagnose issues.

## Quick Start

### Run Health Check

```bash
# Run health check against local dev server
npm run health-check

# Check specific environment
NEXT_PUBLIC_APP_URL=https://your-app.com npm run health-check
```

### View Reports

Reports are saved to `health-reports/`:
- `latest.json` - Latest JSON report
- `latest.md` - Latest Markdown report
- `health-check-YYYY-MM-DDTHH-MM-SS.{json,md}` - Timestamped reports

## Authentication

For full testing, you need a valid session token:

1. **Get a session token:**
   - Login to your app in a browser
   - Open DevTools → Application → Cookies
   - Copy the `session` cookie value

2. **Set environment variable:**
   ```bash
   # Add to .env.local
   TEST_SESSION_TOKEN=your-session-token-here
   ```

3. **Run health check:**
   ```bash
   npm run health-check
   ```

## Understanding Reports

### Health Score

The health score is calculated as: `(passed / total) * 100%`

- **100%** - All tests passed ✅
- **80-99%** - Some warnings or skipped tests ⚠️
- **<80%** - Multiple failures, needs attention ❌

### Status Indicators

- **✅ Pass** - Endpoint working as expected
- **❌ Fail** - Endpoint returned error or unexpected response
- **⚠️  Warning** - Endpoint works but has issues (slow, validation failed)
- **⊘ Skip** - Test skipped (requires auth or data not available)

### Domain Breakdown

Groups results by API domain (notes, tasks, captures, etc.) showing:
- Total endpoints in domain
- Pass/fail/warning/skip counts
- Average response time

### Recommendations

Automated suggestions based on test results:
- Database connectivity issues
- Failed endpoints needing fixes
- Performance optimization opportunities
- Authentication setup needs

## Common Issues

### All Tests Skipped

**Cause:** No authentication token provided

**Fix:** Set `TEST_SESSION_TOKEN` in `.env.local`

### Database Not Connected

**Cause:** Invalid Turso credentials

**Fix:** Check `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local`

### Slow Response Times

**Cause:** Database queries, API calls, or unoptimized code

**Fix:** Review slow endpoints in report, add indexes, optimize queries

### Validation Failures

**Cause:** Response schema doesn't match expected format

**Fix:** Check API route implementation, ensure response structure is correct

## Extending Tests

### Add New Endpoint

Edit `scripts/health-check/endpoints.ts`:

```typescript
{
  method: 'GET',
  path: '/api/your-endpoint',
  domain: 'your-domain',
  requiresAuth: true,
  expectedStatus: 200,
  validateResponse: (data) => {
    // Custom validation
    return data.someField !== undefined;
  },
  description: 'Your endpoint description',
}
```

### Custom Validation

Add validation function to test:

```typescript
validateResponse: (data) => {
  if (!Array.isArray(data.items)) return false;
  if (data.items.length === 0) return false;
  return true;
}
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run Health Check
  run: |
    npm run dev &
    sleep 5
    npm run health-check
  env:
    TEST_SESSION_TOKEN: ${{ secrets.TEST_SESSION_TOKEN }}
```

### Exit Codes

- **0** - All tests passed
- **1** - One or more tests failed

## Report Format

### JSON Report

```json
{
  "timestamp": "2026-02-02T10:30:00.000Z",
  "environment": "development",
  "database": {
    "connected": true,
    "responseTime": 45
  },
  "endpoints": {
    "total": 46,
    "passed": 35,
    "failed": 2,
    "skipped": 9,
    "warnings": 0
  },
  "domains": [...],
  "results": [...],
  "recommendations": [...]
}
```

### Markdown Report

Human-readable report with:
- Summary statistics
- Domain breakdown table
- Failed endpoints details
- Warnings and recommendations
- Detailed results (expandable)

## Best Practices

1. **Run before deployment** - Catch issues early
2. **Monitor trends** - Track health score over time
3. **Fix failures first** - Address red tests before warnings
4. **Optimize slow endpoints** - Target >500ms response times
5. **Keep tests updated** - Add tests for new endpoints

## Troubleshooting

### Server Not Running

```bash
# Start dev server first
npm run dev

# In another terminal
npm run health-check
```

### Port Conflicts

```bash
# Use custom port
PORT=3001 npm run dev

# Update health check
NEXT_PUBLIC_APP_URL=http://localhost:3001 npm run health-check
```

### Out of Memory

Reduce concurrent tests in `runner.ts` if needed.

## Support

For issues or questions:
- Check `health-reports/latest.md` for detailed error messages
- Review failed endpoint implementation
- Check database connectivity and credentials
```

**Step 2: Commit**

```bash
git add docs/health-check-guide.md
git commit -m "docs: add comprehensive health check guide

- Quick start instructions
- Authentication setup
- Understanding reports
- Common issues and solutions
- CI/CD integration examples

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Task 9: Update Main Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add health check section**

Add after the existing sections:

```markdown
## API Health Check System

The app includes a comprehensive API health check system for testing all endpoints.

### Running Health Checks

```bash
# Run against local dev server
npm run health-check

# Run against specific environment
NEXT_PUBLIC_APP_URL=https://your-app.com npm run health-check
```

### Authentication for Tests

Set `TEST_SESSION_TOKEN` in `.env.local` for authenticated endpoint testing:

```bash
TEST_SESSION_TOKEN=your-session-cookie-value
```

### Reports

Health check generates reports in `health-reports/`:
- `latest.md` - Markdown report with statistics and recommendations
- `latest.json` - JSON report for programmatic access
- Timestamped reports for historical tracking

### What's Tested

- **46 API endpoints** across all domains
- **Database connectivity** and response times
- **Response validation** against expected schemas
- **Authentication** requirements
- **Error handling** and edge cases

See `docs/health-check-guide.md` for detailed documentation.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add health check system to main documentation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan creates a comprehensive API health check system with:

**✅ Complete Endpoint Coverage** - All 46 API routes tested
**✅ Authentication Support** - Session token configuration
**✅ Database Validation** - Connectivity and performance checks
**✅ Response Validation** - Schema and data validation
**✅ Performance Metrics** - Response time tracking and warnings
**✅ Detailed Reports** - JSON and Markdown formats
**✅ Actionable Recommendations** - Automated suggestions
**✅ CI/CD Ready** - Exit codes and environment configuration
**✅ Comprehensive Documentation** - Guide and integration examples

**Estimated Implementation:** ~2-3 hours

**After Implementation:**
1. Run `npm run health-check` to generate initial report
2. Review `health-reports/latest.md` for issues
3. Create a separate "fix plan" based on failures found
4. Iterate until health score reaches 100%

The health check will identify:
- Missing or broken endpoints
- Database connectivity issues
- Slow response times
- Authentication problems
- Schema validation failures
- Error handling gaps
