-- Stateless legacy-history audit used by connect_database(). No old DDL is
-- changed: frozen schema guards and legacy two-table initialization remain
-- compatible. Runtime admission serializes check + first execution-prefix
-- event with BEGIN IMMEDIATE. This query is not a database UNIQUE constraint.
SELECT run_id, tool_call_id, event_type
FROM main.events
WHERE event_type IN ('TOOL_INTENT', 'TOOL_RESULT') AND tool_call_id IS NOT NULL
GROUP BY run_id, tool_call_id, event_type
HAVING COUNT(*) > 1;
