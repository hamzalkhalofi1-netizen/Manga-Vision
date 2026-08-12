---
name: Imported workspace workflow ownership
description: Dependency restoration and duplicate workflow behavior after importing multi-artifact pnpm projects
---

Imported pnpm workspaces may contain lockfiles but no `node_modules`, so every artifact workflow can fail with missing binaries until `pnpm install --frozen-lockfile` is run. Multi-artifact imports can also generate standalone frontend/backend workflows alongside a legacy parent workflow; if both launch the same service, the duplicate fails with `EADDRINUSE`.

**Why:** The imported project had valid source and lockfiles but no installed packages, and its parent workflow plus generated API workflow both attempted to own port 8080.

**How to apply:** Restore dependencies from the lockfile first. Then identify the single owner for each port; keep the parent frontend/proxy workflow and one backend workflow, or remove the duplicate parent task through the validated `.replit` replacement flow.