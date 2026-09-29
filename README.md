# ServiceMemory

> Every technician learns from the technicians who came before.

Field-service organizational memory built on **Hindsight by Vectorize**. Full README is written in Phase 13;
see `HANDOFF.md` for the current technical state and `CONTINUE.md` for the next task.

## Quick start (current checkpoint)
```bash
npm install
cp .env.example .env.local      # fill in Hindsight, Supabase, Anthropic values
npm run verify:hindsight        # proves the real Hindsight Cloud integration
npm test && npm run typecheck && npm run build
```
Database: run `supabase/migrations/0001_init.sql` in the Supabase SQL editor.
"# ServiceMemory" 
