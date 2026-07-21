-- At most one active mission-scoped orchestrator per mission_id.
CREATE UNIQUE INDEX `idx_role_assignments_one_orchestrator_per_mission`
ON `role_assignments` (`mission_id`)
WHERE `active` = 1
  AND `role_id` = 'orchestrator'
  AND `scope_kind` = 'mission'
  AND `mission_id` IS NOT NULL;
