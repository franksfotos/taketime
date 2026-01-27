export enum CardType {
  SOLAR = 'SOLAR',
  LUNAR = 'LUNAR',
}

export interface Card {
  id: string;
  type: CardType;
  value: number;
  isFaceUp: boolean;
  ownerId?: string; // which player holds/played it
}

export interface ClockSegment {
  index: number; // 0-5
  cards: Card[];
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isLocal: boolean;
}

export enum GamePhase {
  SETUP = 'SETUP',
  DISCUSSION = 'DISCUSSION',
  PLACEMENT = 'PLACEMENT',
  RESOLUTION = 'RESOLUTION',
}

export interface ValidationResult {
  passed: boolean;
  message?: string;
}

export interface ClockDefinition {
  id: string;
  name: string;
  chapter: number;
  description: string;
  startingSegmentIndex: number; // The "Hand" position
  maxTotal?: number; 
  
  // Visual hints to display on the clock slots (e.g. "Sum 8-12")
  visualHints?: { [segmentIndex: number]: string };

  // Validation Logic
  segmentRules?: { 
    [segmentIndex: number]: (segment: ClockSegment) => ValidationResult 
  };
  globalRules?: (segments: ClockSegment[]) => ValidationResult;
  
  // Placement Restriction (Runs BEFORE placing a card)
  placementRestriction?: (
    card: Card, 
    targetSegmentIndex: number, 
    currentSegments: ClockSegment[], 
    cardsPlayedTotal: number
  ) => ValidationResult;
}