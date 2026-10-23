CREATE TABLE "vector_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection" text NOT NULL,
	"source" text,
	"doc_type" text,
	"title" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vector_documents_collection_hash_unique" ON "vector_documents" USING btree ("collection","content_hash");--> statement-breakpoint
CREATE INDEX "vector_documents_collection_idx" ON "vector_documents" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "vector_documents_collection_model_idx" ON "vector_documents" USING btree ("collection","embedding_model");--> statement-breakpoint
CREATE INDEX "vector_documents_embedding_hnsw" ON "vector_documents" USING hnsw ("embedding" vector_cosine_ops);