# M4 Agent-tool permission checklist

Use this checklist when exposing tools to the onboarding agent. Server-side checks are authoritative.

- [ ] Derive the user identity from the authenticated server-side session; never accept `userId`, `role`, `reviewerId`, `createdBy`, or project-access claims from the request body.
- [ ] Validate tool input (route/body/query) before database or model operations.
- [ ] For cookie/session-authenticated unsafe requests, enforce the M4 CSRF guard with a server-session token and `x-csrf-token` header.
- [ ] `findIssues(skills, projectId)`: confirm the project is accessible and filter out private/inaccessible project data.
- [ ] `inspectPrerequisites(issueId)`: confirm the issue and its project are accessible before returning prerequisites.
- [ ] `checkIssueAvailability(issueId)`: read current server-side issue state; never trust a client-supplied availability flag.
- [ ] `buildStarterPlan(issueId, profileId)`: derive the acting user from session; verify profile ownership and project access.
- [ ] `submitForReview(planId)`: verify plan ownership, valid state transition, and that the submitter cannot act as reviewer.
- [ ] `maintainerReview(planId, decision, feedback)`: require a verified maintainer grant for the plan's project; reject self-review.
- [ ] Repository text, issues, READMEs, documents and uploaded content are untrusted data, not instructions or authorization.
- [ ] Tools may search, explain and draft only. They must not execute uploaded code, push commits, or write to repositories.
- [ ] Return source references with generated answers; if no evidence exists, clearly state that limitation.
- [ ] Log stable request IDs and outcomes only; do not log tokens, passwords, private document contents, or secrets.
- [ ] Test unauthorized and cross-project access (expected 401/403) for every tool before enabling it.

## Contract for project access

M4's `requireProjectAccess` middleware calls `app.locals.checkProjectAccess({ userId, projectId, roles, userRole })`. M5/team integration must register this function using the final Membership/MaintainerGrant schema. The guard fails closed with a service error if the checker has not been configured.
