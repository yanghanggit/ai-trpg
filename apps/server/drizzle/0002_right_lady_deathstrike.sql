-- 形态写法去掉方括号：`[种族]:描述` → `种族:描述`。方括号在 Markdown 里是链接引用定义语法，
-- 导出成 .md 时会被判成未使用的引用。先放开旧约束，迁移存量，再收紧成新写法。
ALTER TABLE "actor_signatures" DROP CONSTRAINT "actor_signatures_form_format";--> statement-breakpoint
UPDATE "actor_signatures" SET "form" = regexp_replace("form", '^\[([^\]\r\n]+)\]:', '\1:') WHERE "form" ~ '^\[[^\]\r\n]+\]:';--> statement-breakpoint
ALTER TABLE "actor_signatures" ADD CONSTRAINT "actor_signatures_form_format" CHECK ("actor_signatures"."form" ~ '^[^:[\]\r\n]+:\S[^\r\n]*$');
