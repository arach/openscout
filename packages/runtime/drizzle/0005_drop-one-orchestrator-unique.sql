-- Drop partial unique so enforceSingleOrchestrator:false / --allow-multiple works.
-- Single-orchestrator default remains enforced in assignRole() under a write transaction.
DROP INDEX IF EXISTS `idx_role_assignments_one_orchestrator_per_mission`;
