import React, { useState, useEffect, useRef } from 'react';
import { Card, ClockSegment, Player, GamePhase, ClockDefinition, CardType } from './types';
import { CLOCK_DEFINITIONS, TOTAL_SEGMENTS } from './constants';
import { createDeck, dealCards, validateClock, findBestBotMove } from './utils/gameUtils';
import Clock from './components/Clock';
import CardComponent from './components/CardComponent';

enum ExtendedGamePhase {
  LOBBY = 'LOBBY',
  SETUP = 'SETUP',
  START_PLAYER_SELECTION = 'START_PLAYER_SELECTION',
  PLACEMENT = 'PLACEMENT',
  RESOLUTION = 'RESOLUTION'
}

declare const Peer: any;

const App: React.FC = () => {
  // --- Game State ---
  const [phase, setPhase] = useState<ExtendedGamePhase | GamePhase>(ExtendedGamePhase.LOBBY);
  const [activeClockDef, setActiveClockDef] = useState<ClockDefinition>(CLOCK_DEFINITIONS[0]);
  const [clockSegments, setClockSegments] = useState<ClockSegment[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0); 
  
  // Use a temporary random ID until PeerJS connects, ensures no collision if Peer fails
  const [myPlayerId, setMyPlayerId] = useState(() => 'user-' + Math.random().toString(36).substr(2, 9));
  const [myName, setMyName] = useState('Player ' + Math.floor(Math.random() * 100));
  
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [playFaceUp, setPlayFaceUp] = useState(false);
  const [faceUpTokensUsed, setFaceUpTokensUsed] = useState(0);
  const [cardsPlayedCount, setCardsPlayedCount] = useState(0);
  const [feedback, setFeedback] = useState<string>("");

  // Networking
  const [peer, setPeer] = useState<any>(null);
  const [conn, setConn] = useState<any>(null);
  const [isHost, setIsHost] = useState(false);
  
  // Lobby State
  const [targetLobbyId, setTargetLobbyId] = useState<string>(""); // For joining
  const [remotePeers, setRemotePeers] = useState<{conn: any, name: string}[]>([]); // For host to track connections
  const [playerCountSetting, setPlayerCountSetting] = useState(3);

  // Resolution
  const [resolutionStep, setResolutionStep] = useState<number>(-1); 
  const [resolutionResults, setResolutionResults] = useState<{index: number, passed: boolean, message?: string}[]>([]);

  // --- Authoritative State Ref (Host Only) ---
  const gameStateRef = useRef({
      players: [] as Player[],
      clockSegments: [] as ClockSegment[],
      currentPlayerIndex: 0,
      phase: ExtendedGamePhase.LOBBY as any,
      activeClockDef: CLOCK_DEFINITIONS[0],
      faceUpTokensUsed: 0,
      cardsPlayedCount: 0,
  });

  // Keep Ref in Sync
  useEffect(() => {
      gameStateRef.current = {
          players,
          clockSegments,
          currentPlayerIndex,
          phase,
          activeClockDef,
          faceUpTokensUsed,
          cardsPlayedCount
      };
  }, [players, clockSegments, currentPlayerIndex, phase, activeClockDef, faceUpTokensUsed, cardsPlayedCount]);

  // --- Initialization ---

  // 1. Handle URL Params for joining
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lobbyParam = params.get('lobby');
    if (lobbyParam) {
        setTargetLobbyId(lobbyParam);
        setIsHost(false);
    }
  }, []);

  // 2. Initialize PeerJS
  useEffect(() => {
    if (typeof Peer !== 'undefined') {
        const newPeer = new Peer(null, { debug: 1 });
        
        newPeer.on('open', (id: string) => {
            console.log('My peer ID: ' + id);
            setMyPlayerId(id); // CRITICAL: Update my ID to match Peer ID
        });
        
        newPeer.on('connection', (connection: any) => {
            handleHostConnection(connection);
        });
        
        newPeer.on('error', (err: any) => {
            console.error(err);
            setFeedback("Network Error: " + err.type);
        });
        
        setPeer(newPeer);
    }
    return () => {
        if (peer) peer.destroy();
    };
  }, []);

  // --- Connection Handlers ---

  // Host receiving a connection
  const handleHostConnection = (connection: any) => {
      connection.on('open', () => {
          // Wait for JOIN message to get name
          connection.on('data', (data: any) => {
              if (data.type === 'JOIN') {
                  setFeedback(`${data.name} joined the lobby!`);
                  setRemotePeers(prev => [...prev, { conn: connection, name: data.name }]);
              } else {
                  handleIncomingData(data, connection);
              }
          });
      });
      connection.on('close', () => {
          setRemotePeers(prev => prev.filter(p => p.conn !== connection));
      });
  };

  // Client connecting to Host
  const connectToHost = (hostId: string) => {
      if (!peer) return;
      setFeedback("Connecting...");
      const connection = peer.connect(hostId);
      
      connection.on('open', () => {
          setConn(connection);
          setIsHost(false);
          setFeedback("Connected! Waiting for host to start...");
          connection.send({ type: 'JOIN', name: myName });
          
          connection.on('data', (data: any) => {
              handleIncomingData(data, null);
          });
      });
      
      connection.on('error', (err: any) => setFeedback("Connection Failed: " + err));
  };

  const broadcastState = (statePayload: any) => {
      if (!isHost) return;
      remotePeers.forEach(p => p.conn.send({ type: 'STATE_UPDATE', state: statePayload }));
  };

  const handleIncomingData = (data: any, sender: any) => {
      if (isHost) {
          if (data.type === 'MOVE') {
              executePlayCard(data.playerId, data.card, data.segmentIndex, data.faceUp);
          }
          if (data.type === 'CLAIM_START') {
              setFeedback(`${data.name} claimed start!`);
              const currentPlayers = gameStateRef.current.players;
              const pIdx = currentPlayers.findIndex(p => p.id === data.playerId);
              if (pIdx !== -1) startGamePhase(pIdx);
          }
      } else {
          // Client Logic
          if (data.type === 'STATE_UPDATE') {
              const s = data.state;
              setPhase(s.phase);
              setPlayers(s.players);
              setClockSegments(s.clockSegments);
              setCurrentPlayerIndex(s.currentPlayerIndex);
              setFaceUpTokensUsed(s.faceUpTokensUsed);
              setCardsPlayedCount(s.cardsPlayedCount);
              setActiveClockDef(CLOCK_DEFINITIONS.find(c => c.id === s.clockDefId) || CLOCK_DEFINITIONS[0]);
              
              if (s.phase === ExtendedGamePhase.RESOLUTION && s.resolutionStep !== undefined) {
                  setResolutionStep(s.resolutionStep);
                  setResolutionResults(s.resolutionResults);
              }
          }
      }
  };

  // --- Game Control (Host) ---

  const initGame = (clockId: string) => {
      const def = CLOCK_DEFINITIONS.find(c => c.id === clockId) || CLOCK_DEFINITIONS[0];
      setActiveClockDef(def);
      
      const newSegments = Array.from({ length: TOTAL_SEGMENTS }, (_, i) => ({ index: i, cards: [] }));
      setClockSegments(newSegments);
      
      const deck = createDeck();
      const pCount = playerCountSetting; 
      const dealtHands = dealCards(deck, pCount);
      
      // Construct Player List
      // Slot 0: Host (Me)
      const newPlayers: Player[] = [
          { id: myPlayerId, name: myName, isLocal: true, hand: dealtHands[0] },
      ];
      
      // Slot 1..N: Remote Players first, then Bots
      let handIndex = 1;
      
      // Add connected peers
      remotePeers.forEach((p, i) => {
          if (handIndex < pCount) {
              newPlayers.push({ 
                  id: p.conn.peer, // Use their Peer ID
                  name: p.name, 
                  isLocal: false, 
                  hand: dealtHands[handIndex] 
              });
              handIndex++;
          }
      });
      
      // Fill rest with Bots
      while (handIndex < pCount) {
          newPlayers.push({ 
              id: `bot-${handIndex}`, 
              name: `Bot ${handIndex}`, 
              isLocal: false, 
              hand: dealtHands[handIndex] 
          });
          handIndex++;
      }

      setPlayers(newPlayers);
      setFaceUpTokensUsed(0);
      setCardsPlayedCount(0);
      setResolutionStep(-1);
      setResolutionResults([]);
      
      const startPhase = ExtendedGamePhase.START_PLAYER_SELECTION;
      setPhase(startPhase);
      
      const initialState = {
          phase: startPhase,
          players: newPlayers,
          clockSegments: newSegments,
          currentPlayerIndex: 0,
          faceUpTokensUsed: 0,
          cardsPlayedCount: 0,
          clockDefId: def.id
      };
      
      gameStateRef.current = { ...gameStateRef.current, ...initialState, activeClockDef: def };
      broadcastState(initialState);
  };

  const handleClaimStart = () => {
      if (phase !== ExtendedGamePhase.START_PLAYER_SELECTION) return;
      if (isHost) {
          const myIdx = players.findIndex(p => p.id === myPlayerId);
          startGamePhase(myIdx);
      } else {
          conn.send({ type: 'CLAIM_START', playerId: myPlayerId, name: myName });
      }
  };

  const startGamePhase = (startIndex: number) => {
      setCurrentPlayerIndex(startIndex);
      setPhase(ExtendedGamePhase.PLACEMENT);
      setFeedback(`${players[startIndex].name} starts!`);
      
      const state = {
          phase: ExtendedGamePhase.PLACEMENT,
          players: gameStateRef.current.players,
          clockSegments: gameStateRef.current.clockSegments,
          currentPlayerIndex: startIndex,
          faceUpTokensUsed: gameStateRef.current.faceUpTokensUsed,
          cardsPlayedCount: gameStateRef.current.cardsPlayedCount,
          clockDefId: gameStateRef.current.activeClockDef.id
      };
      broadcastState(state);
  };

  // --- Bot Turn Logic ---
  useEffect(() => {
      if (!isHost || phase !== ExtendedGamePhase.PLACEMENT) return;

      const currentP = players[currentPlayerIndex];
      // Check if current player is a bot
      if (currentP && !currentP.isLocal && currentP.id.startsWith('bot')) {
          const timer = setTimeout(() => {
              const { players: currPlayers, clockSegments: currSegments, cardsPlayedCount: currCount, activeClockDef: currDef } = gameStateRef.current;
              const botPlayer = currPlayers.find(p => p.id === currentP.id);
              if (botPlayer) {
                  const bestMove = findBestBotMove(botPlayer.hand, currSegments, currDef, currCount);
                  if (bestMove) {
                      executePlayCard(botPlayer.id, bestMove.card, bestMove.segmentIndex, false);
                  } else if (botPlayer.hand.length > 0) {
                      executePlayCard(botPlayer.id, botPlayer.hand[0], 0, false);
                  }
              }
          }, 1000);
          return () => clearTimeout(timer);
      }
  }, [currentPlayerIndex, phase, isHost, players]); 

  // --- Player Moves ---

  const handleCardSelect = (cardId: string) => {
    if (phase !== ExtendedGamePhase.PLACEMENT) return;
    const player = players.find(p => p.id === myPlayerId);
    if (!player) return; // Should not happen with unique IDs
    
    // Strict Turn check
    if (players[currentPlayerIndex].id !== myPlayerId) return;
    
    if (player.hand.some(c => c.id === cardId)) {
        if (selectedCardId === cardId) {
            setSelectedCardId(null); 
        } else {
            setSelectedCardId(cardId);
            setPlayFaceUp(false); 
        }
    }
  };

  const handleSegmentClick = (segmentIndex: number) => {
    if (phase !== ExtendedGamePhase.PLACEMENT) return;
    if (players[currentPlayerIndex].id !== myPlayerId) return;
    if (!selectedCardId) { setFeedback("Select a card first."); return; }

    const player = players.find(p => p.id === myPlayerId);
    const cardToPlay = player?.hand.find(c => c.id === selectedCardId);
    if (!cardToPlay) return;

    const faceUpLimit = players.length;
    if (playFaceUp && faceUpTokensUsed >= faceUpLimit) {
        setFeedback(`Limit of ${faceUpLimit} Face-Up cards reached.`);
        return;
    }

    if (activeClockDef.placementRestriction) {
        const check = activeClockDef.placementRestriction(cardToPlay, segmentIndex, clockSegments, cardsPlayedCount);
        if (!check.passed) { setFeedback(`Invalid Move: ${check.message}`); return; }
    }

    if (isHost) {
        executePlayCard(myPlayerId, cardToPlay, segmentIndex, playFaceUp);
    } else {
        conn.send({ type: 'MOVE', playerId: myPlayerId, card: cardToPlay, segmentIndex, faceUp: playFaceUp });
        setFeedback("Move sent...");
        setSelectedCardId(null);
    }
  };

  const executePlayCard = (playerId: string, card: Card, segmentIndex: number, faceUp: boolean) => {
      const { players: currPlayers, clockSegments: currSegments, faceUpTokensUsed: currFaceUp, cardsPlayedCount: currCount, activeClockDef: currDef } = gameStateRef.current;

      const newPlayers = currPlayers.map(p => {
        if (p.id === playerId) {
            return { ...p, hand: p.hand.filter(c => c.id !== card.id) };
        }
        return p;
      });
      
      const playedCard = { ...card, isFaceUp: faceUp, ownerId: playerId };
      const newSegments = [...currSegments];
      newSegments[segmentIndex] = {
          ...newSegments[segmentIndex],
          cards: [...newSegments[segmentIndex].cards, playedCard]
      };

      const newFaceUpCount = faceUp ? currFaceUp + 1 : currFaceUp;
      const newCount = currCount + 1;
      const currentIdx = currPlayers.findIndex(p => p.id === playerId);
      const nextIdx = (currentIdx + 1) % currPlayers.length;
      
      setPlayers(newPlayers);
      setClockSegments(newSegments);
      setFaceUpTokensUsed(newFaceUpCount);
      setCardsPlayedCount(newCount);
      setCurrentPlayerIndex(nextIdx);
      setSelectedCardId(null);

      const allEmpty = newPlayers.every(p => p.hand.length === 0);
      let nextPhase = gameStateRef.current.phase;
      
      if (allEmpty) {
          nextPhase = ExtendedGamePhase.RESOLUTION;
          setPhase(nextPhase);
          setFeedback("Resolving...");
          startResolution(newSegments);
      }

      broadcastState({
          phase: nextPhase,
          players: newPlayers,
          clockSegments: newSegments,
          currentPlayerIndex: nextIdx,
          faceUpTokensUsed: newFaceUpCount,
          cardsPlayedCount: newCount,
          clockDefId: currDef.id
      });
  };

  // --- Resolution Loop ---
  const startResolution = (finalSegments: ClockSegment[]) => {
      setResolutionStep(0);
  };

  useEffect(() => {
    if (phase === ExtendedGamePhase.RESOLUTION && resolutionStep >= 0 && resolutionStep < TOTAL_SEGMENTS) {
        const timer = setTimeout(() => {
            const segment = clockSegments[resolutionStep];
            let passed = true;
            let msg = "";

            if (segment.cards.length === 0) {
                passed = false; msg = "Empty";
            } else {
                if (activeClockDef.segmentRules && activeClockDef.segmentRules[resolutionStep]) {
                    const res = activeClockDef.segmentRules[resolutionStep](segment);
                    if (!res.passed) { passed = false; msg = res.message || "Rule Failed"; }
                }
                if (passed && resolutionStep > 0) {
                    const prevSum = clockSegments[resolutionStep - 1].cards.reduce((acc,c) => acc + c.value, 0);
                    const currSum = segment.cards.reduce((acc,c) => acc + c.value, 0);
                    if (currSum < prevSum) { passed = false; msg = "Not Ascending"; }
                }
            }

            const newResult = { index: resolutionStep, passed, message: msg };
            setResolutionResults(prev => [...prev, newResult]);
            setResolutionStep(prev => prev + 1);
            
            if (isHost) {
                broadcastState({
                    phase: ExtendedGamePhase.RESOLUTION,
                    players,
                    clockSegments,
                    currentPlayerIndex,
                    faceUpTokensUsed,
                    cardsPlayedCount,
                    clockDefId: activeClockDef.id,
                    resolutionStep: resolutionStep + 1,
                    resolutionResults: [...resolutionResults, newResult]
                });
            }
        }, 2000); 
        return () => clearTimeout(timer);
    } else if (phase === ExtendedGamePhase.RESOLUTION && resolutionStep === TOTAL_SEGMENTS) {
        if (isHost) {
            const totalValidation = validateClock(clockSegments, activeClockDef);
            const allPassed = totalValidation.every(r => r.passed);
            setFeedback(allPassed ? "VICTORY!" : "DEFEAT!");
        }
    }
  }, [phase, resolutionStep, clockSegments]);

  // --- Render ---

  if (phase === ExtendedGamePhase.LOBBY) {
      const inviteLink = myPlayerId ? `${window.location.origin}${window.location.pathname}?lobby=${myPlayerId}` : '';

      return (
          <div className="min-h-screen bg-void flex flex-col items-center justify-center p-4 text-parchment animate-deal">
              <h1 className="text-6xl font-serif text-gold mb-8 drop-shadow-lg">Take Time</h1>
              
              <div className="bg-void-light p-8 rounded-xl border border-gold-dim shadow-2xl w-full max-w-md relative">
                  <div className="mb-4">
                      <label className="block text-sm text-gray-400 mb-1">Your Name</label>
                      <input 
                        className="w-full bg-void border border-gray-600 p-2 rounded text-lg focus:border-gold outline-none"
                        value={myName}
                        onChange={e => setMyName(e.target.value)}
                      />
                  </div>

                  <div className="flex gap-4 mb-6">
                      <button onClick={() => setIsHost(true)} className={`flex-1 p-3 rounded font-bold transition-all ${isHost ? 'bg-gold text-void' : 'bg-gray-700 hover:bg-gray-600'}`}>
                          Host Game
                      </button>
                      <button onClick={() => setIsHost(false)} className={`flex-1 p-3 rounded font-bold transition-all ${!isHost ? 'bg-gold text-void' : 'bg-gray-700 hover:bg-gray-600'}`}>
                          Join Game
                      </button>
                  </div>

                  {isHost ? (
                      <div className="space-y-4">
                          <div>
                              <label className="block text-sm text-gray-400 mb-1">Total Players (including Bots)</label>
                              <div className="flex gap-2">
                                  <button onClick={() => setPlayerCountSetting(3)} className={`flex-1 py-2 rounded border ${playerCountSetting===3 ? 'border-gold bg-gold bg-opacity-20' : 'border-gray-600'}`}>3</button>
                                  <button onClick={() => setPlayerCountSetting(4)} className={`flex-1 py-2 rounded border ${playerCountSetting===4 ? 'border-gold bg-gold bg-opacity-20' : 'border-gray-600'}`}>4</button>
                              </div>
                          </div>
                          
                          <div className="bg-black bg-opacity-30 p-4 rounded text-center">
                              <p className="text-xs text-gray-500 uppercase">Share this Invite Link</p>
                              <div className="flex items-center gap-2 mt-2">
                                  <input readOnly value={inviteLink} className="flex-1 bg-transparent text-gold font-mono text-sm border-none outline-none text-ellipsis" />
                                  <button onClick={() => navigator.clipboard.writeText(inviteLink)} className="bg-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-600">Copy</button>
                              </div>
                          </div>
                          
                          <div className="text-sm text-gray-400 border-t border-gray-700 pt-2">
                             <div className="font-bold mb-1">Connected Players:</div>
                             {remotePeers.length === 0 ? <span className="italic opacity-50">Waiting for players...</span> : (
                                 <ul className="list-disc pl-5">
                                     {remotePeers.map((p,i) => <li key={i} className="text-white">{p.name}</li>)}
                                 </ul>
                             )}
                          </div>

                          <div className="border-t border-gray-700 pt-4">
                              <h3 className="text-gold mb-2">Select Mission to Start:</h3>
                              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                  {CLOCK_DEFINITIONS.map(c => (
                                      <button key={c.id} onClick={() => initGame(c.id)} className="text-left text-xs p-2 border border-gray-600 hover:bg-white hover:bg-opacity-10 rounded">
                                          {c.name}
                                      </button>
                                  ))}
                              </div>
                          </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          <div>
                              <label className="block text-sm text-gray-400 mb-1">Lobby Code / Host ID</label>
                              <input 
                                className="w-full bg-void border border-gray-600 p-2 rounded font-mono text-center uppercase tracking-widest"
                                placeholder="Enter Host ID"
                                value={targetLobbyId}
                                onChange={(e) => setTargetLobbyId(e.target.value)}
                              />
                          </div>
                          <button onClick={() => connectToHost(targetLobbyId)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded">
                              CONNECT
                          </button>
                          {targetLobbyId && (
                              <div className="text-xs text-center text-gray-500 animate-pulse">
                                  Check that Host is ready before connecting...
                              </div>
                          )}
                      </div>
                  )}
              </div>
              <div className="mt-4 text-xs text-gray-500">
                  My ID: {myPlayerId || "Connecting..."}
              </div>
          </div>
      );
  }

  const myPlayer = players.find(p => p.id === myPlayerId);
  const faceUpLimit = players.length;

  return (
    <div className="min-h-screen bg-void text-parchment font-sans selection:bg-gold selection:text-void flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-3 bg-void-light shadow-md z-10">
            <div className="flex items-center gap-4">
               <h2 className="text-xl font-serif text-gold hidden md:block">{activeClockDef.name}</h2>
               {phase === ExtendedGamePhase.START_PLAYER_SELECTION && (
                   <button 
                    onClick={handleClaimStart}
                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded shadow animate-pulse font-bold text-sm md:text-base whitespace-nowrap"
                   >
                       I Start!
                   </button>
               )}
            </div>
            
            <div className="flex gap-2">
                {players.map((p, i) => (
                    <div key={p.id} className={`flex flex-col items-center px-2 py-1 rounded border min-w-[60px] ${i === currentPlayerIndex ? 'border-gold bg-gold bg-opacity-10' : 'border-gray-700'}`}>
                        <span className="text-[10px] font-bold text-gray-300 truncate max-w-[80px]">{p.name} {p.id === myPlayerId && "(You)"}</span>
                        <div className="flex -space-x-1 mt-1">
                            {p.hand.map((_, idx) => <div key={idx} className="w-2 h-3 bg-gray-500 rounded-sm border border-black"></div>)}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="text-right">
                <div className="text-xs text-gray-400">Face Up</div>
                <div className={`font-bold ${faceUpTokensUsed>=faceUpLimit ? 'text-red-400' : 'text-green-400'}`}>
                    {faceUpTokensUsed}/{faceUpLimit}
                </div>
            </div>
        </div>

        {/* Board */}
        <div className="flex-1 relative flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] overflow-hidden">
            <Clock 
                segments={clockSegments} 
                onSegmentClick={handleSegmentClick}
                highlightedIndex={null}
                definition={activeClockDef}
                revealAll={false} 
                resolutionStep={phase === ExtendedGamePhase.RESOLUTION ? resolutionStep : -1}
                resolutionResults={resolutionResults}
            />
            {feedback && (
                <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-90 border border-gold px-6 py-2 rounded-full text-lg animate-pulse z-50 whitespace-nowrap pointer-events-none">
                    {feedback}
                </div>
            )}
             {phase === ExtendedGamePhase.RESOLUTION && resolutionStep === TOTAL_SEGMENTS && (
                 <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-50">
                     <button onClick={() => setPhase(ExtendedGamePhase.LOBBY)} className="bg-gold text-void px-8 py-3 rounded font-bold shadow-lg hover:bg-white border-2 border-void">
                         Return to Lobby
                     </button>
                 </div>
            )}
        </div>

        {/* Hand Area */}
        <div className="bg-void-light border-t border-gold-dim p-4 flex flex-col items-center z-20">
            {phase === ExtendedGamePhase.PLACEMENT && myPlayer && (
                 <div className="w-full max-w-5xl flex items-center justify-between gap-4">
                     <div className="flex flex-col items-start gap-2">
                         <div className="text-sm font-bold text-gold">
                            {players[currentPlayerIndex].id === myPlayerId ? "YOUR TURN" : `${players[currentPlayerIndex].name}'s Turn`}
                         </div>
                         <label className={`flex items-center gap-2 cursor-pointer transition-opacity ${(!selectedCardId || faceUpTokensUsed >= faceUpLimit) ? 'opacity-50' : 'opacity-100'}`}>
                             <div className={`w-6 h-6 rounded border flex items-center justify-center ${playFaceUp ? 'bg-gold border-gold' : 'border-gray-500'}`}>
                                 {playFaceUp && <span className="text-black text-xs">✓</span>}
                             </div>
                             <input type="checkbox" className="hidden" checked={playFaceUp} onChange={e => setPlayFaceUp(e.target.checked)} disabled={!selectedCardId || faceUpTokensUsed >= faceUpLimit} />
                             <span className="text-sm">Play Face Up</span>
                         </label>
                     </div>

                     <div className="flex -space-x-2 md:space-x-4 overflow-visible px-4 py-2">
                         {myPlayer.hand.map(card => (
                             <CardComponent 
                                key={card.id} 
                                card={card} 
                                onClick={() => handleCardSelect(card.id)}
                                selected={selectedCardId === card.id}
                             />
                         ))}
                     </div>
                 </div>
            )}
             {phase === ExtendedGamePhase.START_PLAYER_SELECTION && (
                 <div className="text-center text-parchment animate-pulse">
                     Wait... who goes first? (Click 'I Start')
                 </div>
             )}
        </div>
    </div>
  );
};

export default App;