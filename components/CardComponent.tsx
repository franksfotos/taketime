import React from 'react';
import { Card, CardType } from '../types';

interface CardProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  hidden?: boolean; // If true, show back
  revealOverride?: boolean; // Force show face (for resolution)
}

const CardComponent: React.FC<CardProps> = ({ card, onClick, selected, small, hidden, revealOverride }) => {
  const isRevealed = card.isFaceUp || revealOverride;
  const showBack = hidden && !isRevealed;

  // Base layout
  const baseClasses = `
    relative rounded-lg border-[3px] transition-all duration-200 cursor-pointer card-shadow select-none
    ${selected ? 'ring-4 ring-white transform -translate-y-4 z-50' : 'hover:transform hover:-translate-y-2 hover:z-40 hover:border-white'}
    ${small ? 'w-10 h-14 md:w-12 md:h-16' : 'w-20 h-32 md:w-24 md:h-36'}
    flex items-center justify-center font-bold font-serif
  `;

  const isSolar = card.type === CardType.SOLAR;
  
  // High contrast themes
  // Solar: Gold background, Dark text (or White on Dark Gold)
  // Lunar: Dark Blue background, White text
  
  // Back styling
  const backBg = isSolar ? 'bg-amber-600' : 'bg-indigo-900'; 
  const backBorder = isSolar ? 'border-amber-300' : 'border-indigo-400';

  if (showBack) {
    return (
      <div 
        onClick={onClick} 
        className={`${baseClasses} ${backBg} ${backBorder}`}
        title={`${isSolar ? 'Solar' : 'Lunar'} Card (Hidden)`}
      >
        <div className={`w-3/4 h-3/4 rounded-full border-4 opacity-40 ${isSolar ? 'border-amber-200 bg-amber-500' : 'border-indigo-300 bg-indigo-700'}`}></div>
      </div>
    );
  }

  // Front Styling
  const typeBorder = isSolar ? 'border-yellow-400' : 'border-cyan-300';
  const typeBg = isSolar ? 'bg-yellow-100' : 'bg-slate-900';
  const textColor = isSolar ? 'text-yellow-900' : 'text-cyan-50';
  const iconColor = isSolar ? 'text-orange-500' : 'text-cyan-400';

  return (
    <div 
      onClick={onClick} 
      className={`${baseClasses} ${typeBg} ${typeBorder} ${textColor}`}
    >
      {/* Top Left Icon */}
      <div className={`absolute top-1 left-1 leading-none ${small ? 'text-xs' : 'text-xl'} ${iconColor}`}>
        {isSolar ? '☀' : '☾'}
      </div>
      
      {/* Main Value - SUPER LARGE */}
      <span className={`${small ? 'text-2xl' : 'text-6xl'} font-black tracking-tighter drop-shadow-sm`}>
        {card.value}
      </span>

      {/* Bottom Right Icon */}
      <div className={`absolute bottom-1 right-1 leading-none ${small ? 'text-xs' : 'text-xl'} transform rotate-180 ${iconColor}`}>
        {isSolar ? '☀' : '☾'}
      </div>
      
      {/* Visual indicator for "Played Face Up" (The token) */}
      {card.isFaceUp && !revealOverride && (
        <div className="absolute -top-2 -right-2 bg-green-500 rounded-full p-1 border-2 border-void shadow-md z-10">
          <div className="w-2 h-2 bg-white rounded-full"></div>
        </div>
      )}
    </div>
  );
};

export default CardComponent;