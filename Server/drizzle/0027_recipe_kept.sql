-- How a recipe's batches are kept, chosen on the recipe, for the use-by on
-- their labels. Until now Mise read it from the storage note; the recipes a
-- kitchen already has get the choice that note gave, by the same rules as
-- keptAs() in packages/domain/src/useby.ts (a temperature decides, then
-- chilled, frozen, dry, each word on its own or at the start of one, in any
-- case and without accents). A note it can't place stays unchosen (null), and
-- its labels still go by the note.
CREATE TYPE "public"."kept" AS ENUM('chilled_7', 'chilled_4', 'frozen', 'ambient', 'hot');--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "kept" "kept";--> statement-breakpoint
WITH "plain" AS (
	SELECT "id",
		lower(translate("storage",
			'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž',
			'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZz')) AS "note"
	FROM "recipe"
	WHERE "kept" IS NULL AND btrim(coalesce("storage", '')) <> ''
), "read" AS (
	SELECT "id", "note",
		replace(substring("note" FROM '(-?\d+(?:[.,]\d+)?)\s*(?:°\s*c?|c\y|graden|grad\y|degrees|degres|grados)'), ',', '.')::numeric AS "degrees",
		"note" ~ '(?<![[:alpha:]])(chill|fridge|walk-in|walk in|cold room|cool room|koel|gekoeld|kuhl|gekuhlt|refrig|frigo|chambre froide|nevera|camara|frigorific)' AS "chilled",
		"note" ~ '(?<![[:alpha:]])(freez|frozen|vriez|vries|diepvries|invries|ingevroren|bevroren|tiefkuhl|gefror|gefrier|congel|surgel)' AS "frozen",
		"note" ~ '(?<![[:alpha:]])(dry|ambient|room temp|pantry|droog|kamertemperatuur|trocken|raumtemperatur|au sec|ambiante|seco|ambiente|despensa)' AS "ambient"
	FROM "plain"
)
UPDATE "recipe" SET "kept" = (CASE
	WHEN "read"."degrees" <= -12 THEN 'frozen'
	WHEN "read"."degrees" <= 4 THEN 'chilled_4'
	WHEN "read"."degrees" <= 7 THEN 'chilled_7'
	-- Warmer than 7 °C is not chilled: dry if it says so, else unknown.
	WHEN "read"."degrees" IS NOT NULL THEN CASE WHEN "read"."ambient" THEN 'ambient' END
	WHEN "read"."chilled" THEN 'chilled_7'
	WHEN "read"."frozen" THEN 'frozen'
	WHEN "read"."ambient" THEN 'ambient'
END)::"kept"
FROM "read"
WHERE "recipe"."id" = "read"."id";