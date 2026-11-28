-- The agent and its approval inbox were removed. These tables are no
-- longer read or written. Dropping them also drops their policies.

DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS approvals;
