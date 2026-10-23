UPDATE "actors"
SET "actions" = (
	SELECT coalesce(
		jsonb_agg(
			CASE
				WHEN value = to_jsonb('query_knowledge_base'::text) THEN to_jsonb('query'::text)
				ELSE value
			END
		),
		'[]'::jsonb
	)
	FROM jsonb_array_elements("actions") AS value
)
WHERE "actions" @> '["query_knowledge_base"]'::jsonb;--> statement-breakpoint
