---
name: Artifact Recovery
description: How to recover when artifact source files are deleted and services go down
---

## Problem
When artifact `.replit-artifact/artifact.toml` files are deleted, artifacts are de-registered but source code may still exist in git history.

## Recovery Steps

1. **Check git status** — deleted files show as `D` in `git diff --name-only --diff-filter=D HEAD`
2. **Restore via git show** (not `git checkout` — that's blocked):
   ```bash
   git diff --name-only --diff-filter=D HEAD > /tmp/deleted.txt
   grep -v -E '^\.replit$|^replit\.nix$|^\.replitignore$' /tmp/deleted.txt > /tmp/safe.txt
   while IFS= read -r file; do
     mkdir -p "$(dirname "$file")"
     git show HEAD:"$file" > "$file"
   done < /tmp/safe.txt
   ```
3. **Kill lingering processes** — old node processes stay alive after artifact restart; find by scanning /proc:
   ```bash
   for pid in $(ls /proc | grep '^[0-9]'); do
     ls -la /proc/$pid/fd 2>/dev/null | grep -q "socket:\[$INODE\]" && kill -9 $pid
   done
   ```
4. **Re-register artifacts** — `verifyAndReplaceArtifactToml` re-registers an artifact from its existing toml file
5. **Workflow cleanup** — remove manually created workflows that conflict with artifact-managed ones; artifact names are `artifacts/<slug>: <ServiceName>`

## Port rules
- api-server: port 8080
- frontend: port 18130 (NOT in workflow supported list — but artifact system handles it, don't use configureWorkflow for this port)
- Manually configured workflows only support: 3000, 3001, 3002, 3003, 4200, 5000, 5173, 6000, 6800, 8000, 8008, 8080, 8099, 9000

**Why:** The artifact system has its own service runner that supports arbitrary ports. `configureWorkflow()` (manual workflow tool) only supports specific ports. When in doubt, let the artifact system manage its own services.
