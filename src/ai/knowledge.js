import { config } from '../config.js';
import { many, query, tx } from '../db/index.js';
import { checksum, cleanText, splitWords } from '../utils/text.js';
import { id } from '../utils/ids.js';
import { getOpenAI } from './openai-client.js';

export function chunkText(input, { size = 1200, overlap = 180 } = {}) {
  const text = cleanText(input, config.limits.knowledgeDocumentChars).replace(/\r\n/g, '\n');
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length <= size) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= size) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += size - overlap) {
      chunks.push(paragraph.slice(index, index + size));
    }
    current = '';
  }
  if (current) chunks.push(current);
  return chunks.map((value) => value.trim()).filter(Boolean).slice(0, 1000);
}

export async function embedTexts(texts) {
  if (!config.openai.apiKey || !texts.length) return texts.map(() => null);
  const client = getOpenAI();
  const results = [];
  for (let index = 0; index < texts.length; index += 64) {
    const batch = texts.slice(index, index + 64);
    const response = await client.embeddings.create({ model: config.openai.embeddingModel, input: batch });
    results.push(...response.data.map((item) => item.embedding));
  }
  return results;
}

export async function createKnowledgeDocument({ tenantId, clientId, agentId = null, title, content, sourceType = 'text', sourceUrl = null, metadata = {} }) {
  const normalized = cleanText(content, config.limits.knowledgeDocumentChars);
  const chunks = chunkText(normalized);
  if (!chunks.length) throw new Error('Knowledge document is empty.');
  const embeddings = await embedTexts(chunks);
  return tx(async (client) => {
    const documentId = id('doc');
    const result = await client.query(`INSERT INTO knowledge_documents(id,tenant_id,client_id,agent_id,title,source_type,source_url,content,checksum,status,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10)
      ON CONFLICT(client_id,checksum) DO UPDATE SET title=EXCLUDED.title, source_url=EXCLUDED.source_url, updated_at=now()
      RETURNING *`, [documentId, tenantId, clientId, agentId, cleanText(title, 180), sourceType, cleanText(sourceUrl, 500) || null, normalized, checksum(normalized), JSON.stringify(metadata)]);
    const document = result.rows[0];
    await client.query('DELETE FROM knowledge_chunks WHERE document_id=$1', [document.id]);
    for (let index = 0; index < chunks.length; index += 1) {
      await client.query(`INSERT INTO knowledge_chunks(id,tenant_id,client_id,document_id,chunk_index,content,embedding,token_count,metadata)
                          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        id('chunk'), tenantId, clientId, document.id, index, chunks[index], embeddings[index] ? JSON.stringify(embeddings[index]) : null, Math.ceil(chunks[index].length / 4), JSON.stringify({ title: document.title })
      ]);
    }
    return { document, chunkCount: chunks.length, embedded: embeddings.some(Boolean) };
  });
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0; let left = 0; let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2;
  }
  return left && right ? dot / (Math.sqrt(left) * Math.sqrt(right)) : 0;
}

function lexicalScore(queryText, content) {
  const queryWords = [...new Set(splitWords(queryText).filter((word) => word.length > 2))];
  if (!queryWords.length) return 0;
  const lower = content.toLowerCase();
  let matches = 0;
  let weighted = 0;
  for (const word of queryWords) {
    if (lower.includes(word)) {
      matches += 1;
      weighted += word.length >= 7 ? 1.3 : 1;
    }
  }
  const phraseBoost = lower.includes(cleanText(queryText, 500).toLowerCase()) ? 1 : 0;
  return Math.min(1, (weighted / queryWords.length) * 0.72 + phraseBoost * 0.28);
}

export async function retrieveKnowledge({ tenantId, clientId, agentId = null, queryText, limit = 6 }) {
  const chunks = await many(`SELECT kc.id,kc.content,kc.embedding,kc.chunk_index,kc.document_id,kd.title,kd.source_url
    FROM knowledge_chunks kc JOIN knowledge_documents kd ON kd.id=kc.document_id
    WHERE kc.tenant_id=$1 AND kc.client_id=$2 AND kd.status='ready' AND (kd.agent_id IS NULL OR kd.agent_id=$3)
    ORDER BY kd.updated_at DESC, kc.chunk_index ASC LIMIT 1000`, [tenantId, clientId, agentId]);
  if (!chunks.length) return [];
  const [queryEmbedding] = await embedTexts([queryText]);
  return chunks
    .map((chunk) => {
      const lexical = lexicalScore(queryText, chunk.content);
      const semantic = queryEmbedding && chunk.embedding ? cosine(queryEmbedding, chunk.embedding) : 0;
      return { ...chunk, score: queryEmbedding ? semantic * 0.72 + lexical * 0.28 : lexical };
    })
    .filter((chunk) => chunk.score > 0.04)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((chunk) => ({
      id: chunk.id,
      documentId: chunk.document_id,
      title: chunk.title,
      sourceUrl: chunk.source_url,
      content: chunk.content,
      score: Number(chunk.score.toFixed(4))
    }));
}

export async function reindexMissingEmbeddings({ tenantId, clientId }) {
  if (!config.openai.apiKey) return { updated: 0 };
  const chunks = await many(`SELECT id,content FROM knowledge_chunks WHERE tenant_id=$1 AND client_id=$2 AND embedding IS NULL LIMIT 1000`, [tenantId, clientId]);
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  let updated = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    if (!embeddings[index]) continue;
    await query('UPDATE knowledge_chunks SET embedding=$1 WHERE id=$2', [JSON.stringify(embeddings[index]), chunks[index].id]);
    updated += 1;
  }
  return { updated };
}
