import { CardType, ClockDefinition, ValidationResult } from './types';

// Helper to sum card values
export const sumCards = (cards: any[]) => cards.reduce((acc, c) => acc + c.value, 0);

export const CLOCK_DEFINITIONS: ClockDefinition[] = [
  {
    id: 'c1-1',
    chapter: 1,
    name: 'Clock I',
    description: 'Slot 1: Exactly 1 Lunar card. Slot 6: Exactly 3 cards.',
    startingSegmentIndex: 0,
    maxTotal: 999, 
    visualHints: {
      0: "1x ☾ Only",
      5: "3 Cards"
    },
    segmentRules: {
      0: (seg): ValidationResult => { // Slot 1
         const lunarCount = seg.cards.filter(c => c.type === CardType.LUNAR).length;
         if (lunarCount === 1 && seg.cards.length === 1) return { passed: true };
         return { passed: false, message: `Slot 1 must have exactly 1 Lunar card.` };
      },
      5: (seg): ValidationResult => { // Slot 6
         if (seg.cards.length === 3) return { passed: true };
         return { passed: false, message: `Slot 6 must have exactly 3 cards.` };
      }
    },
    placementRestriction: (card, targetIndex, currentSegments) => {
        // Strict enforcement for AI/Player
        if (targetIndex === 0) {
            if (card.type !== CardType.LUNAR) return { passed: false, message: "Slot 1 only accepts Lunar cards." };
            if (currentSegments[0].cards.length >= 1) return { passed: false, message: "Slot 1 is full (Max 1)." };
        }
        return { passed: true };
    }
  },
  {
    id: 'c1-2',
    chapter: 1,
    name: 'Clock II',
    description: 'Slot 3: Sum 8-12. Slot 4: Exactly 3 cards.',
    startingSegmentIndex: 0,
    maxTotal: 999,
    visualHints: {
      2: "Σ 8-12",
      3: "3 Cards"
    },
    segmentRules: {
      2: (seg): ValidationResult => {
        const total = sumCards(seg.cards);
        if (total >= 8 && total <= 12) return { passed: true };
        return { passed: false, message: `Slot 3 sum is ${total}, must be 8-12.` };
      },
      3: (seg): ValidationResult => {
        if (seg.cards.length === 3) return { passed: true };
        return { passed: false, message: `Slot 4 must have exactly 3 cards.` };
      }
    }
  },
  {
    id: 'c1-3',
    chapter: 1,
    name: 'Clock III',
    description: '1st Card -> Slot 3. 2nd Card -> Slot 2. Slot 6: Sum 20-30.',
    startingSegmentIndex: 0,
    maxTotal: 999,
    visualHints: {
      2: "1st Card",
      1: "2nd Card",
      5: "Σ 20-30"
    },
    segmentRules: {
      5: (seg): ValidationResult => {
         const total = sumCards(seg.cards);
         if (total >= 20 && total <= 30) return { passed: true };
         return { passed: false, message: `Slot 6 sum is ${total}, must be 20-30.` };
      }
    },
    placementRestriction: (card, targetIndex, currentSegments, cardsPlayedTotal) => {
       if (cardsPlayedTotal === 0 && targetIndex !== 2) return { passed: false, message: "1st card must go to Slot 3." };
       if (cardsPlayedTotal === 1 && targetIndex !== 1) return { passed: false, message: "2nd card must go to Slot 2." };
       return { passed: true };
    }
  },
  {
    id: 'c1-4',
    chapter: 1,
    name: 'Clock IV',
    description: '6th Card -> Slot 1. Slot 4: 1 Solar, 1 Lunar.',
    startingSegmentIndex: 0, 
    maxTotal: 24, 
    visualHints: {
      0: "6th Card",
      3: "1☀ 1☾"
    },
    segmentRules: {
      3: (seg): ValidationResult => {
         const solarCount = seg.cards.filter(c => c.type === CardType.SOLAR).length;
         const lunarCount = seg.cards.filter(c => c.type === CardType.LUNAR).length;
         if (solarCount === 1 && lunarCount === 1) return { passed: true };
         return { passed: false, message: "Slot 4 must have exactly 1 Solar and 1 Lunar." };
      }
    },
    placementRestriction: (card, targetIndex, currentSegments, cardsPlayedTotal) => {
      if (cardsPlayedTotal === 5 && targetIndex !== 0) return { passed: false, message: "6th card must go to Slot 1." };
      
      // Strict enforcement for Slot 4
      if (targetIndex === 3) {
          const currentCards = currentSegments[3].cards;
          if (currentCards.length >= 2) return { passed: false, message: "Slot 4 is full." };
          
          const hasSolar = currentCards.some(c => c.type === CardType.SOLAR);
          const hasLunar = currentCards.some(c => c.type === CardType.LUNAR);
          
          if (hasSolar && card.type === CardType.SOLAR) return { passed: false, message: "Slot 4 already has a Solar card." };
          if (hasLunar && card.type === CardType.LUNAR) return { passed: false, message: "Slot 4 already has a Lunar card." };
      }
      return { passed: true };
    }
  }
];

export const TOTAL_SEGMENTS = 6;