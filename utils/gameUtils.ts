import { Card, CardType, ClockDefinition, ClockSegment, ValidationResult } from '../types';
import { sumCards, TOTAL_SEGMENTS } from '../constants';

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  for (let i = 1; i <= 12; i++) {
    deck.push({ id: `s-${i}`, type: CardType.SOLAR, value: i, isFaceUp: false });
  }
  for (let i = 1; i <= 12; i++) {
    deck.push({ id: `l-${i}`, type: CardType.LUNAR, value: i, isFaceUp: false });
  }
  return shuffle(deck);
};

const shuffle = <T,>(array: T[]): T[] => {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
};

export const dealCards = (deck: Card[], playerCount: number) => {
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  
  // Rule: Always 12 cards in play total (timeline).
  // 3 Players -> 4 Cards each (12 total)
  // 4 Players -> 3 Cards each (12 total)
  
  let cardsPerPlayer = 4;
  if (playerCount === 4) cardsPerPlayer = 3;
  if (playerCount === 2) cardsPerPlayer = 6;

  let cardIdx = 0;
  for (let p = 0; p < playerCount; p++) {
    for (let c = 0; c < cardsPerPlayer; c++) {
      if (cardIdx < deck.length) {
        hands[p].push(deck[cardIdx]);
        cardIdx++;
      }
    }
  }
  return hands;
};

// Check if a move is valid based on placement restrictions
export const isValidMove = (
    card: Card, 
    segmentIndex: number, 
    segments: ClockSegment[], 
    definition: ClockDefinition, 
    cardsPlayedTotal: number
): boolean => {
    if (definition.placementRestriction) {
        const res = definition.placementRestriction(card, segmentIndex, segments, cardsPlayedTotal);
        if (!res.passed) return false;
    }
    return true;
};

// Find a valid move for the bot
export const findBestBotMove = (
    hand: Card[], 
    segments: ClockSegment[], 
    definition: ClockDefinition, 
    cardsPlayedTotal: number
): { card: Card, segmentIndex: number } | null => {
    
    // 1. Try to find a valid move
    const validMoves: { card: Card, segmentIndex: number }[] = [];
    
    for (const card of hand) {
        for (let i = 0; i < TOTAL_SEGMENTS; i++) {
            if (isValidMove(card, i, segments, definition, cardsPlayedTotal)) {
                validMoves.push({ card, segmentIndex: i });
            }
        }
    }

    if (validMoves.length > 0) {
        // Randomly pick a valid move
        return validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    // 2. If no valid moves, must play somewhere (even if it violates rules)
    // Just pick random
    if (hand.length > 0) {
        return { card: hand[0], segmentIndex: Math.floor(Math.random() * TOTAL_SEGMENTS) };
    }

    return null;
};

export const validateClock = (segments: ClockSegment[], definition: ClockDefinition): ValidationResult[] => {
  const results: ValidationResult[] = [];

  // 1. At least 1 card per segment
  segments.forEach(seg => {
    if (seg.cards.length === 0) {
      results.push({ passed: false, message: `Segment ${seg.index + 1} is empty.` });
    }
  });

  // 2. Ascending order relative to hand
  let previousSum = -1;
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const currentIdx = (definition.startingSegmentIndex + i) % TOTAL_SEGMENTS;
    const currentSum = sumCards(segments[currentIdx].cards);

    if (i === 0) {
      previousSum = currentSum;
    } else {
      if (currentSum < previousSum) {
        results.push({ 
          passed: false, 
          message: `Ascending violation at Segment ${currentIdx + 1} (Sum: ${currentSum}) vs previous (Sum: ${previousSum}).` 
        });
      }
      previousSum = currentSum;
    }

    if (definition.maxTotal && currentSum > definition.maxTotal) {
       results.push({ 
          passed: false, 
          message: `Segment ${currentIdx + 1} sum (${currentSum}) exceeds limit of ${definition.maxTotal}.` 
        });
    }

    if (definition.segmentRules && definition.segmentRules[currentIdx]) {
      const res = definition.segmentRules[currentIdx](segments[currentIdx]);
      if (!res.passed) results.push(res);
    }
  }

  if (definition.globalRules) {
    const res = definition.globalRules(segments);
    if (!res.passed) results.push(res);
  }

  if (results.length === 0) return [{ passed: true, message: "Clock Validated Successfully!" }];
  return results;
};