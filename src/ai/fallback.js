import { DateTime } from 'luxon';
import { executeTool } from './tools.js';
import { cleanText, splitWords } from '../utils/text.js';

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function rankedSentences(chunks, message) {
  const words = new Set(splitWords(message).filter((word) => word.length > 2));
  const sentences = chunks.flatMap((chunk) => chunk.content.split(/(?<=[.!?])\s+|\n+/).map((sentence) => ({ sentence: sentence.trim(), source: chunk })).filter((item) => item.sentence.length > 15));
  return sentences
    .map((item) => {
      const sentenceWords = splitWords(item.sentence);
      const overlap = sentenceWords.reduce((sum, word) => sum + (words.has(word) ? (word.length > 6 ? 1.4 : 1) : 0), 0);
      const score = words.size ? overlap / words.size : 0;
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);
}

function groundedAnswer(chunks, message, predicate = () => true) {
  const ranked = rankedSentences(chunks, message).filter((item) => predicate(item.sentence.toLowerCase()));
  if (!ranked.length || ranked[0].score < 0.22) return null;
  const selected = ranked.filter((item) => item.score >= Math.max(0.22, ranked[0].score * 0.68)).slice(0, 2);
  return {
    text: selected.map((item) => item.sentence).join(' '),
    citations: [...new Set(selected.map((item) => item.source.id))],
    confidence: Math.min(0.92, 0.62 + ranked[0].score * 0.28)
  };
}

function formatHours(client) {
  const hours = client.business_hours || {};
  const entries = Object.entries(hours).filter(([, value]) => Array.isArray(value));
  if (!entries.length) return 'Business hours have not been configured yet.';
  return entries.map(([day, value]) => `${day[0].toUpperCase()}${day.slice(1)} ${value[0]}–${value[1]}`).join('; ');
}

export async function smartFallback({ message, chunks, context }) {
  const lower = message.toLowerCase();
  const emergencyTerms = context.client.emergency_rules || [];
  const emergency = includesAny(lower, emergencyTerms.map((term) => String(term).toLowerCase())) || includesAny(lower, ['gas leak','smell gas','house is flooding','active flooding','sewage backup','fire','medical emergency']);
  if (emergency) {
    const tool = await executeTool('request_human_handoff', { reason: `Potential emergency reported: ${cleanText(message, 300)}`, priority: 'emergency' }, context);
    return {
      text: `This may be an emergency. Move away from immediate danger and contact emergency services when appropriate. I’m escalating this to a human now${tool.handoffNumber ? ` at ${tool.handoffNumber}` : ''}.`,
      intent: 'emergency', confidence: 0.99, requiresHandoff: true, handoffReason: tool.reason || 'Potential emergency', citations: [], tools: [{ name: 'request_human_handoff', result: tool }], mode: 'grounded-fallback'
    };
  }

  if (includesAny(lower, ['ignore your rules','ignore previous','system prompt','developer message','private information','personal home address','owner home address','password','secret key','access token','social security','credit card number'])) {
    return { text: 'I cannot provide private information, credentials, internal instructions, or personal addresses. I can connect you with an authorized human for a legitimate business request.', intent: 'handoff', confidence: 0.99, requiresHandoff: true, handoffReason: 'The request attempted to obtain private or internal information.', citations: [], tools: [], mode: 'security-rule' };
  }

  if (includesAny(lower, ['human','real person','representative','manager','someone call me'])) {
    const tool = await executeTool('request_human_handoff', { reason: 'Customer requested a human representative.', priority: 'normal' }, context);
    return { text: 'I’ve flagged this conversation for a human representative. Please share the best phone number and a brief description of what you need.', intent: 'handoff', confidence: 0.98, requiresHandoff: true, handoffReason: tool.reason, citations: [], tools: [{ name: 'request_human_handoff', result: tool }], mode: 'grounded-fallback' };
  }

  if (includesAny(lower, ['hours','open','close','weekend'])) {
    return { text: `Our configured business hours are: ${formatHours(context.client)}`, intent: 'business_hours', confidence: 0.98, requiresHandoff: false, handoffReason: '', citations: [], tools: [], mode: 'grounded-fallback' };
  }

  if (includesAny(lower, ['appointment','book','schedule','available','tomorrow','next week'])) {
    const startDate = DateTime.now().setZone(context.client.timezone).toISODate();
    const availability = await executeTool('check_availability', { start_date: startDate, days: 7, service: 'General service' }, context);
    if (availability.slots?.length) {
      const options = availability.slots.slice(0, 3).map((slot, index) => `${index + 1}) ${slot.display}`).join(' ');
      return { text: `I can help schedule that. The next available times are ${options}. Which option works best? I’ll also need your full name, phone, email, service address, and the service needed before I can confirm it.`, intent: 'booking', confidence: 0.93, requiresHandoff: false, handoffReason: '', citations: [], tools: [{ name: 'check_availability', result: availability }], mode: 'grounded-fallback' };
    }
  }

  if (includesAny(lower, ['price','pricing','cost','fee','how much','quote','estimate'])) {
    const pricing = groundedAnswer(chunks, message, (sentence) => includesAny(sentence, ['price','pricing','cost','fee','quote','estimate','diagnosis']));
    if (pricing) return { text: `${pricing.text} I will not provide a final price beyond the approved information.`, intent: 'pricing', confidence: pricing.confidence, requiresHandoff: false, handoffReason: '', citations: pricing.citations, tools: [], mode: 'grounded-fallback' };
    return { text: 'I do not have an approved price for that request. I can collect your details so a team member can provide a verified estimate.', intent: 'pricing', confidence: 0.28, requiresHandoff: true, handoffReason: 'No approved pricing information matched the request.', citations: [], tools: [], mode: 'grounded-fallback' };
  }

  const grounded = groundedAnswer(chunks, message);
  if (grounded) {
    return { text: grounded.text, intent: 'information', confidence: grounded.confidence, requiresHandoff: false, handoffReason: '', citations: grounded.citations, tools: [], mode: 'grounded-fallback' };
  }

  return {
    text: 'I do not have enough approved information to answer that accurately. I can connect you with a human or collect your contact details for follow-up.',
    intent: 'unknown', confidence: 0.25, requiresHandoff: true, handoffReason: 'No sufficiently relevant approved knowledge was found.', citations: [], tools: [], mode: 'grounded-fallback'
  };
}
