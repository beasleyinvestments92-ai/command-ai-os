import OpenAI from 'openai';
import { config } from '../config.js';

let client;

export function getOpenAI() {
  if (!config.openai.apiKey) throw new Error('OpenAI is not configured.');
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseURL });
  return client;
}

export async function moderateInput(input) {
  if (!config.openai.apiKey) return { flagged: false, categories: {} };
  try {
    const response = await getOpenAI().moderations.create({ model: config.openai.moderationModel, input });
    const result = response.results?.[0];
    return { flagged: Boolean(result?.flagged), categories: result?.categories || {}, scores: result?.category_scores || {} };
  } catch {
    return { flagged: false, categories: {}, unavailable: true };
  }
}
