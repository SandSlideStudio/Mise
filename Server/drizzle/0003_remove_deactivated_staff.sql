-- Removing someone now deletes them. Anyone deactivated under the old
-- behaviour goes the same way, so no list of former staff lingers. Their
-- sessions cascade; prep they were on keeps its line without a name.
DELETE FROM "app_user" WHERE "active" = false;
