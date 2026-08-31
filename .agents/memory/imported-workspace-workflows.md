---
name: Imported workspace workflow ownership
description: Dependency restoration and duplicate workflow behavior after importing multi-artifact pnpm projects
---

Imported pnpm workspaces may contain lockfiles and dependency declarations but still lack a usable package symlink in `node_modules`, so runtime `require()` checks matter even when typecheck resolves the package. Multi-artifact imports can also generate standalone frontend/backend workflows alongside a legacy parent workflow; if both launch the same service, the duplicate fails with `EADDRINUSE`.

**Why:** OpenCV was present in the API package and lockfile but absent from the installed workspace, while the generic package helper targeted the workspace root rather than the API artifact. The imported project also had competing service workflows.

**How to apply:** Restore dependencies from the lockfile, verify critical runtime packages with a direct artifact-scoped load, and install missing packages against the owning workspace rather than the root. Then identify the single owner for each port; keep the parent frontend/proxy workflow and one backend workflow, or remove the duplicate parent task through the validated `.replit` replacement flow.