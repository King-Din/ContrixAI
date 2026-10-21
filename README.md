
# ContrixAI

**An AI-assisted project collaboration and knowledge platform.**

ContrixAI is a modular fullstack application designed to support project collaboration, user authentication, role-based access control, contribution-plan workflows, issue management, document knowledge retrieval, and system monitoring. It provides the foundation for integrating AI-powered project assistance.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [API Endpoints](#api-endpoints)
- [Document Knowledge Base](#document-knowledge-base)
- [Testing](#testing)
- [Security](#security)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Contributing](#contributing)

## Overview

ContrixAI combines project-related workflows in a unified backend architecture. It provides APIs for authentication, authorization, contribution management, issue tracking, document retrieval, and operational monitoring.

The system emphasizes modularity, consistent API responses, controlled access to project resources, and extensibility for future AI integration.

## Features

- **Authentication and Identity:** User authentication, session handling, and identity-related functionality.
- **Role-Based Authorization:** Authentication middleware, role checks, verification guards, and project-access controls.
- **Membership and Contribution Plans:** Models and APIs supporting contribution-related workflows.
- **Issue Management:** Issue-related operations and contributor interest workflows.
- **Document Knowledge Base:** Document ingestion, snapshots, chunking, and searchable project knowledge.
- **System Monitoring:** Health and status functionality for checking application and dependency availability.
- **Centralized Error Handling:** Consistent handling of validation failures, authentication errors, missing resources, and server errors.
- **Demo Data Seeding:** Controlled initialization of development data.
- **Automated Testing:** Tests for backend modules, middleware, and error scenarios.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | HTTP server and API routing |
| MongoDB | Document-oriented database |
| Mongoose | MongoDB object modeling |
| Zod | Request and document validation where configured |
| bcryptjs | Password hashing |
| dotenv | Environment variable management |
| Configured test runner | Automated testing |

Refer to `package.json` for the exact dependencies and available scripts.

## Architecture

ContrixAI follows a modular backend architecture:

1. **Routes:** Define API endpoints and attach middleware.
2. **Middleware:** Handles authentication, authorization, request processing, and errors.
3. **Controllers:** Process HTTP requests and generate responses.
4. **Services:** Contain reusable application logic.
5. **Models:** Define MongoDB data structures.
6. **Validation:** Validates incoming data against defined schemas.
7. **Tests:** Verify module behavior and integration contracts.

## Getting Started

### Prerequisites

Install the following:

- Node.js and npm
- MongoDB Atlas or a compatible MongoDB deployment
- Git
- Visual Studio Code or another code editor
- Postman or another HTTP API client

### 1. Clone the Repository

```bash
git clone https://github.com/King-Din/ContrixAI.git
cd ContrixAI
```

### 2. Install Dependencies

```bash
npm install
```

For a clean installation using the committed lockfile:

```bash
npm ci
```

### 3. Configure Environment Variables

Create a `.env` file in the project root using `.env.example` as a reference.

```env
NODE_ENV=development
PORT=4000
MONGODB_URI=your_mongodb_connection_string
SESSION_SECRET=your_long_random_secret
```

Add any additional variables required by `.env.example`, including settings for document retrieval, vector search, or AI-provider integration.

**Security:** Replace example values with your own configuration. Never commit `.env`, database credentials, session secrets, or API keys to GitHub.

### 4. Start the Development Server

```bash
npm run dev
```

The application uses port `4000` by default unless another port is configured.

### 5. Verify the Server

Send the following request using a browser or API client:

```http
GET http://localhost:4000/health
```

A successful response should indicate the service health and report database connectivity when the database is connected.

## Environment Configuration

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime environment |
| `PORT` | HTTP server port |
| `MONGODB_URI` | MongoDB connection string |
| `SESSION_SECRET` | Secret used for session security |
| M8 configuration variables | Document retrieval, embeddings, or vector search |
| AI-provider variables | Configuration for the selected AI provider |

Use the actual variable names and requirements documented in `.env.example`. Optional integrations may require additional configuration.

## API Endpoints

The following endpoints provide a starting point for exploring the API. Check the route definitions in `src/routes/` for the complete list of supported operations.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Check service health and database connectivity |
| `POST` | `/api/projects/:projectId/docs/import` | Import project documents |
| `POST` | `/api/projects/:projectId/docs/search` | Search indexed document content |
| `GET` | `/api/projects/:projectId/docs/snapshots` | List document snapshots |

Protected endpoints require the applicable authentication and project-access permissions. Consult the corresponding route, controller, and validation files for request bodies, response formats, and authorization requirements.

## Document Knowledge Base

The M8 document subsystem supports project-document ingestion and retrieval.

### Core Capabilities

- Import supported text and Markdown content.
- Validate document input and enforce configured limits.
- Divide documents into searchable chunks.
- Track source paths, headings, hashes, and snapshot information.
- Search indexed content using keyword retrieval.
- Support optional embeddings and MongoDB Atlas Vector Search when configured.
- Track snapshot freshness to help identify potentially outdated knowledge.

### Retrieval Workflow

1. Submit supported project-document content through the import endpoint.
2. Validate and process the content.
3. Store document snapshot and chunk records.
4. Search the project's indexed content.
5. Return relevant evidence with source information for downstream use.

Vector search requires a compatible Atlas Vector Search index and matching embedding configuration. Keyword retrieval can be used when vector search is not enabled, according to the configured implementation.

**Scope:** Document retrieval provides relevant project knowledge. AI-generated answers and end-to-end AI orchestration are separate integration responsibilities.

## Testing

Run the scripts defined in `package.json`.

```bash
npm run check
npm test
```

If additional test scripts are available, run those as appropriate.

### Recommended Verification

- Authentication and session behavior
- Role and project-access enforcement
- Invalid request payloads and validation errors
- Missing resources and unauthorized operations
- Contribution and issue workflows
- Document import, search, and snapshot behavior
- Seed safety and repeated execution
- Error response consistency
- Health checks and database failures

A successful test command alone does not establish that every integration has been tested against a live MongoDB deployment.

## Security

- Store secrets and credentials in environment variables.
- Hash passwords rather than storing plaintext credentials.
- Apply authentication and authorization to protected routes.
- Validate incoming data before database operations.
- Enforce project-level access restrictions.
- Restrict demo seeding to explicitly approved development databases.
- Avoid exposing internal stack traces or sensitive configuration in production responses.
- Configure database permissions and network access appropriately.
- Use HTTPS and secure session-cookie settings in deployed environments.

## Project Structure

```text
ContrixAI/
├── docs/
│   ├── M6-COMPLETION-STATUS.md
│   ├── M8-KNOWLEDGE-BASE.md
│   └── integration-checklist.md
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── seed/
│   ├── services/
│   ├── validation/
│   ├── app.js
│   └── server.js
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

The directory structure may evolve as modules are integrated.

## Development Workflow

Use feature branches and pull requests to keep changes isolated and reviewable.

```bash
git switch main
git pull origin main
git switch -c feature/your-change

git add .
git commit -m "Describe your change"
git push -u origin feature/your-change
```

Then open a pull request against `main` on GitHub.

Before requesting review:

1. Run the available checks and tests.
2. Review the staged changes.
3. Confirm that no secrets or local environment files are included.
4. Verify compatibility with existing module contracts.
5. Document any configuration or migration requirements.

## Contributing

Contributions should follow the existing module boundaries, API contracts, naming conventions, and validation patterns. Changes affecting shared models, routes, middleware, or configuration should be coordinated with the relevant module owners.

## License

Add the project's chosen license before distributing or publishing ContrixAI as an open-source project.
