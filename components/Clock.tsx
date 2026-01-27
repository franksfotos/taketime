import React from 'react';
import { ClockSegment, Card, ClockDefinition } from '../types';
import CardComponent from './CardComponent';

interface ClockProps {
  segments: ClockSegment[];
  onSegmentClick: (index: number) => void;
  highlightedIndex?: number | null;
  definition: ClockDefinition;
  revealAll: boolean; 
  resolutionStep: number;
  resolutionResults: {index: number, passed: boolean, message?: string}[];
}

const Clock: React.FC<ClockProps> = ({ segments, onSegmentClick, highlightedIndex, definition, resolutionStep, resolutionResults }) => {
  const handRotation = -30;

  return (
    <div className="relative w-[340px] h-[340px] md:w-[500px] md:h-[500px] mx-auto rounded-full border-4 border-gold-dim bg-void-light bg-opacity-30 shadow-2xl backdrop-blur-sm">
      {/* Center Info */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center w-32 md:w-48 text-parchment z-0 opacity-40 pointer-events-none">
         <div className="text-4xl md:text-6xl font-serif text-gold">{definition.chapter}</div>
         <div className="text-xs uppercase tracking-widest">{definition.name}</div>
      </div>

      {/* Clock Hand */}
      <div 
        className="absolute top-0 left-0 w-full h-full pointer-events-none transition-transform duration-500"
        style={{ transform: `rotate(${handRotation}deg)` }}
      >
         <div className="absolute top-4 left-1/2 w-1 h-[45%] bg-gradient-to-t from-transparent via-gold to-gold transform -translate-x-1/2 origin-bottom shadow-lg opacity-80">
            <div className="w-4 h-4 bg-gold rounded-full absolute -top-1 left-1/2 -translate-x-1/2 box-shadow-glow"></div>
         </div>
      </div>

      {/* Segments */}
      {segments.map((segment, i) => {
        const rotation = i * 60;
        const isResolving = resolutionStep >= 0;
        const revealed = isResolving && i <= resolutionStep;
        const result = resolutionResults.find(r => r.index === i);

        return (
          <div
            key={i}
            onClick={() => onSegmentClick(i)}
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <div 
              className={`
                absolute top-[2%] left-1/2 transform -translate-x-1/2 
                w-24 h-40 md:w-28 md:h-48
                border-2 rounded-xl pointer-events-auto
                transition-all duration-300 cursor-pointer
                flex flex-col items-center justify-start pt-6 overflow-visible
                ${highlightedIndex === i ? 'border-blue-400 bg-blue-900 bg-opacity-30' : 'border-dashed border-gray-600 hover:bg-white hover:bg-opacity-5'}
                ${result ? (result.passed ? 'border-green-500 bg-green-900 bg-opacity-20' : 'border-red-500 bg-red-900 bg-opacity-20') : ''}
              `}
            >
               {/* Visual Hint */}
               {definition.visualHints && definition.visualHints[i] && (
                   <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-void-light border border-gold-dim text-gold text-xs font-bold px-2 py-0.5 rounded shadow z-50 whitespace-nowrap">
                       {definition.visualHints[i]}
                   </div>
               )}

               <div className="absolute top-1 text-[10px] text-gray-500 font-mono">{i + 1}</div>

               {/* Card Stack */}
               <div className="relative w-full h-full flex flex-col items-center mt-2">
                 {segment.cards.map((card, cIndex) => {
                   // Offset logic: INCREASED offset to make values visible
                   // Small offset when face down to save space
                   // Large offset when face up/revealed to show value
                   const shouldShow = revealed || card.isFaceUp;
                   const offset = shouldShow ? cIndex * 40 : cIndex * 15; 
                   const z = cIndex;
                   
                   return (
                    <div 
                        key={card.id} 
                        className="absolute transition-all duration-500 ease-out"
                        style={{ 
                            top: `${offset}px`, 
                            zIndex: z,
                        }}
                    >
                        <CardComponent 
                            card={card} 
                            small 
                            hidden={!revealed && !card.isFaceUp} 
                            revealOverride={revealed}
                        />
                    </div>
                   );
                 })}
               </div>
               
               {/* Resolution Status */}
               {result && (
                   <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[100] animate-bounce bg-black bg-opacity-50 rounded-full p-2">
                       {result.passed ? (
                           <div className="text-3xl text-green-400">✓</div>
                       ) : (
                           <div className="text-3xl text-red-500">✗</div>
                       )}
                   </div>
               )}

               {/* Sum Bubble */}
               {revealed && segment.cards.length > 0 && (
                   <div className="absolute -bottom-4 bg-void border border-gold px-2 py-1 rounded text-gold font-bold text-lg z-[100] shadow-lg transform" style={{ transform: `rotate(-${rotation}deg)` }}>
                       {segment.cards.reduce((sum, c) => sum + c.value, 0)}
                   </div>
               )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Clock;