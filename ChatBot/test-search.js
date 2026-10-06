require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function normalizeVector(vec) {
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vec;
  return vec.map(val => val / norm);
}

async function search(question) {
  console.log(`\n🔍 Question: "${question}"`);

  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(question);
  const embedding = normalizeVector(result.embedding.values);

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: 3,
  });

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('   No matches found.');
    return;
  }

  data.forEach((row, i) => {
    console.log(`\n   Result ${i + 1} (similarity: ${row.similarity.toFixed(3)})`);
    console.log(`   "${row.content.slice(0, 200)}..."`);
  });
}

async function run() {
  await search('What is Seabrook known for?');
  await search('What is the weather today?');  // Should return weak matches
  await search('How do I contact the city?');
}

run().catch(console.error);