-- 1. Enable pgvector
create extension if not exists vector;

-- 2. Table for website chunks
create table if not exists documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding vector(3072)
);

-- 3. Search function
CREATE OR REPLACE FUNCTION public.match_documents(query_embedding vector, match_threshold double precision, match_count integer)
 RETURNS TABLE(id bigint, content text, metadata jsonb, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$function$

-- 4. Security: no direct table access with the public key
alter table documents enable row level security;


