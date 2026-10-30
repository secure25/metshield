// Card copy templates, versioned with the prompt (card.v1). The validator
// matches card sentences against these patterns; the model is instructed to
// use them verbatim. Template E (decline) is operator-console-only: it lives
// here so the validator recognizes it, but it never appears in the prompt.
//
// Bodies are stored pre-split into sentences, exactly as splitSentences would
// split the joined body. A test pins that the joined bodies equal the prompt
// file's copy, so prompt and validator cannot drift.
export const COPY_VERSION = 'card.v1';

export interface CardTemplate {
  id: string;
  headline: string;
  body: string[];
}

export const CARD_TEMPLATES_V1: CardTemplate[] = [
  {
    id: 'A',
    headline: "This request is linked to an ad you didn't see.",
    body: [
      "The {family} in this chat also appeared in {n} {surface} events we've linked to the same operation.",
      'The warning above already applies — this is why it may also be happening elsewhere.'
    ]
  },
  {
    id: 'B',
    headline: 'The link in this chat also ran as a paid ad.',
    body: [
      'We saw this domain in an ad {timeAgo}.',
      'Leaving the app to pay or enter details is how this pattern usually works.'
    ]
  },
  {
    id: 'C',
    headline: 'This payment handle is used by more than one account.',
    body: [
      "The same handle was used in {n} conversations we've linked.",
      "A handle shared this way is not a person you've verified."
    ]
  },
  {
    id: 'D',
    headline: 'The account asking for your code ran ads for this offer.',
    body: [
      'Nobody legitimate needs the code sent to your phone.',
      'If it was already shared, change your password and sign out other sessions.'
    ]
  },
  {
    id: 'E',
    headline: 'No card emitted.',
    body: ['Reason: {declineReason}.', '{n} indicators, {m} surfaces.', 'Below the cross-surface threshold.']
  },
  {
    id: 'F',
    headline: 'This link is on a public blocklist.',
    body: [
      "This domain is listed in {feedName}'s reported-scam feed, published {publishedAgo}.",
      'That listing is the whole of our evidence — we have not seen it in a conversation or in an ad, and a listing is a claim about the domain, not proof about every use of it.'
    ]
  }
];

export interface TemplateMatch {
  templateId: string;
  fills: Record<string, string>;
}

function matchPattern(pattern: string, text: string): Record<string, string> | null {
  const parts = pattern.split(/\{(\w+)\}/);
  const fills: Record<string, string> = {};
  let pos = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const literal = parts[i];
    if (i === 0) {
      if (!text.startsWith(literal)) return null;
      pos = literal.length;
    } else {
      const idx = text.indexOf(literal, pos);
      if (idx === -1) return null;
      const fill = text.slice(pos, idx);
      if (fill.length === 0) return null;
      fills[parts[i - 1]] = fill;
      pos = idx + literal.length;
    }
  }
  if (pos !== text.length) return null;
  return fills;
}

export function matchSentence(text: string, kind: 'headline' | 'body'): TemplateMatch | null {
  for (const template of CARD_TEMPLATES_V1) {
    if (kind === 'headline') {
      if (text === template.headline) return { templateId: template.id, fills: {} };
    } else {
      for (const sentence of template.body) {
        const fills = matchPattern(sentence, text);
        if (fills !== null) return { templateId: template.id, fills };
      }
    }
  }
  return null;
}
