import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  // --- Persistent Identity ---
  const [myPlayerId] = useState(() => {
      const saved = localStorage.getItem('tt_playerId');
      if (saved) return saved;
      const newId = 'user-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('tt_playerId', newId);
      return newId;
  });
  
  const [myName, setMyName] = useState(() => localStorage.getItem('tt_playerName') || 'Player ' + Math.floor(Math.random() * 100));
  useEffect(() => { localStorage.setItem('tt_playerName', myName); }, [myName]);

  // --- Game State (UI) ---
  const [phase, setPhase] = useState<ExtendedGamePhase | GamePhase>(ExtendedGamePhase.LOBBY);
  const [activeClockDef, setActiveClockDef] = useState<ClockDefinition>(CLOCK_DEFINITIONS[0]);
  const [clockSegments, setClockSegments] = useState<ClockSegment[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0); 
  const [faceUpTokensUsed, setFaceUpTokensUsed] = useState(0);
  const [cardsPlayedCount, setCardsPlayedCount] = useState(0);
  
  // Shared Feedback (System Messages like "Victory", "Edge Starts")
  const [systemMessage, setSystemMessage] = useState<string>("");

  // Local Interaction
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [playFaceUp, setPlayFaceUp] = useState(false);
  const [feedback, setFeedback] = useState<string>(""); // Local transient feedback (e.g. "Invalid Move")

  // Networking
  const [peer, setPeer] = useState<any>(null);
  const [myPeerId, setMyPeerId] = useState<string>(""); 
  const [conn, setConn] = useState<any>(null); // Client: Connection to Host
  const [isHost, setIsHost] = useState(false);
  const [targetLobbyId, setTargetLobbyId] = useState<string>(""); 
  const [connectedPeersList, setConnectedPeersList] = useState<{id: string, name: string}[]>([]); 
  const [playerCountSetting, setPlayerCountSetting] = useState(3);

  // Refs (Source of Truth for Host Logic)
  const peerConnectionsRef = useRef<{ [playerId: string]: any }>({}); 
  const gameStateRef = useRef<any>(null);

  // Resolution
  const [resolutionStep, setResolutionStep] = useState<number>(-1); 
  const [resolutionResults, setResolutionResults] = useState<{index: number, passed: boolean, message?: string}[]>([]);

  // --- State Persistence & Synchronization ---

  // 1. Sync React State to Ref (Host uses this as Truth)
  useEffect(() => {
      gameStateRef.current = {
          phase,
          activeClockDef,
          clockSegments,
          players,
          currentPlayerIndex,
          faceUpTokensUsed,
          cardsPlayedCount,
          clockDefId: activeClockDef?.id,
          resolutionStep,
          resolutionResults,
          systemMessage // Ensure this is tracked
      };

      // Host: Save to LocalStorage
      if (isHost && phase !== ExtendedGamePhase.LOBBY) {
           try {
              const stateToSave = sanitizeStateForNetwork(gameStateRef.current);
              localStorage.setItem('tt_gameState', JSON.stringify(stateToSave));
          } catch (e) {
              console.error("Save failed", e);
          }
      }
  }, [phase, activeClockDef, clockSegments, players, currentPlayerIndex, faceUpTokensUsed, cardsPlayedCount, resolutionStep, resolutionResults, isHost, systemMessage]);

  // 2. Host Recovery on Mount
  useEffect(() => {
      const savedState = localStorage.getItem('tt_gameState');
      if (savedState) {
          try {
              const parsed = JSON.parse(savedState);
              if (parsed.phase && parsed.phase !== ExtendedGamePhase.LOBBY) {
                  console.log("Restoring Game State...");
                  setIsHost(true); 
                  setPhase(parsed.phase);
                  setClockSegments(parsed.clockSegments);
                  setPlayers(parsed.players);
                  setCurrentPlayerIndex(parsed.currentPlayerIndex);
                  setFaceUpTokensUsed(parsed.faceUpTokensUsed || 0);
                  setCardsPlayedCount(parsed.cardsPlayedCount || 0);
                  setSystemMessage(parsed.systemMessage || "");
                  
                  if (parsed.clockDefId) {
                      const def = CLOCK_DEFINITIONS.find(c => c.id === parsed.clockDefId);
                      if (def) setActiveClockDef(def);
                  }

                  if (parsed.phase === ExtendedGamePhase.RESOLUTION) {
                      setResolutionStep(parsed.resolutionStep);
                      setResolutionResults(parsed.resolutionResults || []);
                  }
                  
                  setFeedback("Session Restored. Waiting for players...");
              }
          } catch (e) {
              console.error("Failed to restore state", e);
          }
      }
  }, []);

  // --- Networking Initialization ---

  // Handle URL Params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lobbyParam = params.get('lobby');
    if (lobbyParam) {
        setTargetLobbyId(lobbyParam);
        setIsHost(false); // If joining via link, you are client
    }
  }, []);

  // Initialize PeerJS
  useEffect(() => {
    if (typeof Peer !== 'undefined') {
        const desiredId = `tt-${myPlayerId}`;
        
        const initPeer = (id: string | null) => {
            const newPeer = new Peer(id, { debug: 1 });
            
            newPeer.on('open', (assignedId: string) => {
                console.log('Peer ID Open:', assignedId);
                setMyPeerId(assignedId);
            });
            
            newPeer.on('connection', (connection: any) => {
                handleHostConnection(connection);
            });
            
            newPeer.on('error', (err: any) => {
                console.warn("Peer Error:", err.type);
                if (err.type === 'unavailable-id') {
                    initPeer(null);
                } else {
                    setFeedback("Network Error: " + err.type);
                }
            });
            setPeer(newPeer);
        };

        initPeer(desiredId);
    }
    return () => {
        if (peer) peer.destroy();
    };
  }, []); 

  // --- Host Logic ---

  const handleHostConnection = (connection: any) => {
      connection.on('open', () => {
         console.log("New connection opened");
      });

      connection.on('data', (data: any) => {
          if (data.type === 'JOIN') {
              const pid = data.playerId;
              const name = data.name;
              
              console.log(`Player ${name} (${pid}) joined.`);

              // Store connection
              peerConnectionsRef.current[pid] = connection;

              // Update UI List
              setConnectedPeersList(prev => {
                  const filtered = prev.filter(p => p.id !== pid);
                  return [...filtered, { id: pid, name }];
              });

              // RECONNECT logic
              const currentState = gameStateRef.current;
              if (currentState && currentState.phase !== ExtendedGamePhase.LOBBY) {
                  const existingPlayer = currentState.players.find((p: Player) => p.id === pid);
                  if (existingPlayer) {
                      setFeedback(`${name} reconnected!`);
                      const safeState = sanitizeStateForNetwork(currentState);
                      connection.send({ type: 'STATE_UPDATE', state: safeState });
                  } else {
                       connection.send({ type: 'ERROR', message: "Game already in progress." });
                  }
              } else {
                  setFeedback(`${name} joined lobby.`);
              }
          } else {
              handleIncomingDataHost(data);
          }
      });
      
      connection.on('close', () => {
          console.log("Connection closed");
      });
  };

  const sanitizeStateForNetwork = (fullState: any) => {
      const { activeClockDef, ...rest } = fullState;
      try {
          return JSON.parse(JSON.stringify(rest));
      } catch (e) {
          console.error("State Serialization Failed!", e);
          return rest; 
      }
  };

  const broadcastState = (statePayload: any) => {
      const safeState = sanitizeStateForNetwork(statePayload);
      
      let sentCount = 0;
      Object.values(peerConnectionsRef.current).forEach((conn: any) => {
          if (conn && conn.open) {
              conn.send({ type: 'STATE_UPDATE', state: safeState });
              sentCount++;
          }
      });
      if (sentCount > 0) {
        console.log(`Broadcasted state to ${sentCount} peers. Phase: ${statePayload.phase}`);
      }
  };

  const handleIncomingDataHost = (data: any) => {
      const current = gameStateRef.current;
      if (!current) return;

      if (data.type === 'MOVE') {
          executePlayCard(data.playerId, data.card, data.segmentIndex, data.faceUp);
      }
      if (data.type === 'CLAIM_START') {
          const currentPlayers = current.players;
          const pIdx = currentPlayers.findIndex((p: Player) => p.id === data.playerId);
          if (pIdx !== -1) {
              startGamePhase(pIdx);
          }
      }
  };

  // --- Client Logic ---

  const connectToHost = (hostId: string) => {
      if (!peer) return;
      if (!hostId) { setFeedback("Enter Code"); return; }
      
      setFeedback("Connecting...");
      if (conn) conn.close();

      const connection = peer.connect(hostId);
      
      connection.on('open', () => {
          setConn(connection);
          setIsHost(false);
          setFeedback("Connected! Waiting...");
          connection.send({ type: 'JOIN', name: myName, playerId: myPlayerId });
      });
      
      connection.on('data', (data: any) => {
          if (data.type === 'STATE_UPDATE') {
              console.log("Received State Update. Phase:", data.state.phase);
              applyRemoteState(data.state);
          } else if (data.type === 'ERROR') {
              setFeedback(data.message);
          } else if (data.type === 'RESET') {
              resetGameLocal();
          }
      });
      
      connection.on('error', (err: any) => setFeedback("Connect Failed"));
      connection.on('close', () => setFeedback("Disconnected"));
  };

  const applyRemoteState = (s: any) => {
      setPhase(s.phase);
      setPlayers(s.players);
      setClockSegments(s.clockSegments);
      setCurrentPlayerIndex(s.currentPlayerIndex);
      setFaceUpTokensUsed(s.faceUpTokensUsed);
      setCardsPlayedCount(s.cardsPlayedCount);
      setSystemMessage(s.systemMessage || ""); // Sync system message
      
      if (s.clockDefId) {
          const def = CLOCK_DEFINITIONS.find(c => c.id === s.clockDefId);
          if (def) setActiveClockDef(def);
      }
      
      if (s.phase === ExtendedGamePhase.RESOLUTION) {
          setResolutionStep(s.resolutionStep || -1);
          setResolutionResults(s.resolutionResults || []);
      }
      setFeedback(""); // Clears "Sending..."
  };

  // --- Game Actions (Host) ---

  const abortGame = () => {
      if (window.confirm("Abort current game?")) {
          localStorage.removeItem('tt_gameState');
          const lobbyState = {
              phase: ExtendedGamePhase.LOBBY,
              players: [],
              clockSegments: [],
              currentPlayerIndex: 0,
              faceUpTokensUsed: 0,
              cardsPlayedCount: 0,
              systemMessage: ""
          };
          gameStateRef.current = lobbyState;
          resetGameLocal();
          
          Object.values(peerConnectionsRef.current).forEach((conn: any) => {
              if (conn && conn.open) conn.send({ type: 'RESET' });
          });
      }
  };

  const forceSync = () => {
      if(gameStateRef.current) {
          console.log("Forcing Sync...");
          broadcastState(gameStateRef.current);
          setFeedback("Force Sync Sent");
          setTimeout(() => setFeedback(""), 1000);
      }
  };

  const resetGameLocal = () => {
      setPhase(ExtendedGamePhase.LOBBY);
      setClockSegments([]);
      setPlayers([]);
      setResolutionStep(-1);
      setResolutionResults([]);
      setFaceUpTokensUsed(0);
      setCardsPlayedCount(0);
      setConnectedPeersList([]);
      setSystemMessage("");
  };

  const initGame = (clockId: string) => {
      const def = CLOCK_DEFINITIONS.find(c => c.id === clockId) || CLOCK_DEFINITIONS[0];
      setActiveClockDef(def);
      
      const newSegments = Array.from({ length: TOTAL_SEGMENTS }, (_, i) => ({ index: i, cards: [] }));
      const deck = createDeck();
      const pCount = playerCountSetting; 
      const dealtHands = dealCards(deck, pCount);
      
      const newPlayers: Player[] = [
          { id: myPlayerId, name: myName, isLocal: true, hand: dealtHands[0] },
      ];
      
      let handIndex = 1;
      connectedPeersList.forEach(p => {
          if (handIndex < pCount) {
              newPlayers.push({ id: p.id, name: p.name, isLocal: false, hand: dealtHands[handIndex] });
              handIndex++;
          }
      });
      while (handIndex < pCount) {
          newPlayers.push({ id: `bot-${handIndex}`, name: `Bot ${handIndex}`, isLocal: false, hand: dealtHands[handIndex] });
          handIndex++;
      }

      const startPhase = ExtendedGamePhase.START_PLAYER_SELECTION;
      const initialState = {
          phase: startPhase,
          players: newPlayers,
          clockSegments: newSegments,
          currentPlayerIndex: 0,
          faceUpTokensUsed: 0,
          cardsPlayedCount: 0,
          activeClockDef: def,
          clockDefId: def.id,
          resolutionStep: -1,
          resolutionResults: [],
          systemMessage: ""
      };

      // Set State
      setPlayers(newPlayers);
      setClockSegments(newSegments);
      setFaceUpTokensUsed(0);
      setCardsPlayedCount(0);
      setPhase(startPhase);
      setResolutionStep(-1);
      setResolutionResults([]);
      setSystemMessage("");

      gameStateRef.current = initialState;
      broadcastState(initialState);
  };

  const handleClaimStart = () => {
      if (phase !== ExtendedGamePhase.START_PLAYER_SELECTION) return;
      if (isHost) {
          const myIdx = players.findIndex(p => p.id === myPlayerId);
          startGamePhase(myIdx);
      } else {
          if (conn) {
              conn.send({ type: 'CLAIM_START', playerId: myPlayerId, name: myName });
              setFeedback("Waiting for host...");
          }
      }
  };

  const startGamePhase = (startIndex: number) => {
      const current = gameStateRef.current;
      if (!current || !current.players[startIndex]) return;

      const pName = current.players[startIndex].name;
      const startMsg = `${pName} starts!`;
      setSystemMessage(startMsg); // Global message
      
      const newState = {
          ...current,
          phase: ExtendedGamePhase.PLACEMENT,
          currentPlayerIndex: startIndex,
          resolutionStep: -1,
          resolutionResults: [],
          systemMessage: startMsg
      };
      
      // Update Ref first (Source of Truth)
      gameStateRef.current = newState;
      
      // Update Local UI
      setPhase(ExtendedGamePhase.PLACEMENT);
      setCurrentPlayerIndex(startIndex);
      
      // Broadcast immediately
      broadcastState(newState);
      // Safety broadcast
      setTimeout(() => broadcastState(newState), 500);

      // Clear the "Starts!" message after a bit
      setTimeout(() => {
          if (gameStateRef.current.phase === ExtendedGamePhase.PLACEMENT) {
              setSystemMessage("");
              gameStateRef.current.systemMessage = "";
              broadcastState(gameStateRef.current);
          }
      }, 3000);
  };

  // --- Bot Logic ---
  useEffect(() => {
      if (!isHost || phase !== ExtendedGamePhase.PLACEMENT) return;

      const currentP = players[currentPlayerIndex];
      if (currentP && !currentP.isLocal && currentP.id.startsWith('bot')) {
          const timer = setTimeout(() => {
              const currentState = gameStateRef.current;
              const botPlayer = currentState.players.find((p: Player) => p.id === currentP.id);
              if (botPlayer) {
                  const bestMove = findBestBotMove(botPlayer.hand, currentState.clockSegments, currentState.activeClockDef, currentState.cardsPlayedCount);
                  if (bestMove) {
                      executePlayCard(botPlayer.id, bestMove.card, bestMove.segmentIndex, false);
                  } else if (botPlayer.hand.length > 0) {
                      executePlayCard(botPlayer.id, botPlayer.hand[0], 0, false);
                  }
              }
          }, 1500); 
          return () => clearTimeout(timer);
      }
  }, [currentPlayerIndex, phase, isHost, players]); 

  // --- Interaction ---
  const handleCardSelect = (cardId: string) => {
    if (phase !== ExtendedGamePhase.PLACEMENT) return;
    const player = players.find(p => p.id === myPlayerId);
    if (!player) return; 
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

    // Check Rules (with global counter)
    if (activeClockDef.placementRestriction) {
        const check = activeClockDef.placementRestriction(cardToPlay, segmentIndex, clockSegments, cardsPlayedCount);
        if (!check.passed) { setFeedback(`Invalid: ${check.message}`); return; }
    }

    if (isHost) {
        executePlayCard(myPlayerId, cardToPlay, segmentIndex, playFaceUp);
    } else {
        if (conn) {
            conn.send({ type: 'MOVE', playerId: myPlayerId, card: cardToPlay, segmentIndex, faceUp: playFaceUp });
            setFeedback("Sending...");
            setSelectedCardId(null);
        }
    }
  };

  const executePlayCard = (playerId: string, card: Card, segmentIndex: number, faceUp: boolean) => {
      const curr = gameStateRef.current;
      if (!curr) return;
      
      const newPlayers = curr.players.map((p: Player) => {
        if (p.id === playerId) {
            return { ...p, hand: p.hand.filter((c: Card) => c.id !== card.id) };
        }
        return p;
      });
      
      const playedCard = { ...card, isFaceUp: faceUp, ownerId: playerId };
      const newSegments = [...curr.clockSegments];
      newSegments[segmentIndex] = {
          ...newSegments[segmentIndex],
          cards: [...newSegments[segmentIndex].cards, playedCard]
      };

      const newFaceUpCount = faceUp ? curr.faceUpTokensUsed + 1 : curr.faceUpTokensUsed;
      const newCount = curr.cardsPlayedCount + 1;
      
      const currentIdx = curr.players.findIndex((p: Player) => p.id === playerId);
      const nextIdx = (currentIdx + 1) % curr.players.length;
      
      // Calculate Next Phase
      const allEmpty = newPlayers.every((p: Player) => p.hand.length === 0);
      let nextPhase = curr.phase;
      if (allEmpty) {
          nextPhase = ExtendedGamePhase.RESOLUTION;
          setFeedback("Resolving...");
          startResolution(newSegments);
      }

      const newState = { 
          ...curr,
          phase: nextPhase,
          players: newPlayers,
          clockSegments: newSegments,
          currentPlayerIndex: nextIdx,
          faceUpTokensUsed: newFaceUpCount,
          cardsPlayedCount: newCount
      };

      // Update Ref (Source of Truth)
      gameStateRef.current = newState;
      
      // Update Local UI
      setPlayers(newPlayers);
      setClockSegments(newSegments);
      setFaceUpTokensUsed(newFaceUpCount);
      setCardsPlayedCount(newCount);
      setCurrentPlayerIndex(nextIdx);
      if (nextPhase !== phase) setPhase(nextPhase);
      
      setSelectedCardId(null);
      
      // Broadcast immediately
      broadcastState(newState);
  };

  // --- Resolution Loop ---
  const startResolution = (finalSegments: ClockSegment[]) => {
      setResolutionStep(0);
      setSystemMessage("Resolving...");
      const s = { ...gameStateRef.current, systemMessage: "Resolving..." };
      gameStateRef.current = s;
      broadcastState(s);
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
                const newState = {
                    ...gameStateRef.current,
                    resolutionStep: resolutionStep + 1,
                    resolutionResults: [...resolutionResults, newResult]
                };
                gameStateRef.current = newState;
                broadcastState(newState);
            }
        }, 2000); 
        return () => clearTimeout(timer);
    } else if (phase === ExtendedGamePhase.RESOLUTION && resolutionStep === TOTAL_SEGMENTS) {
        if (isHost) {
            const totalValidation = validateClock(clockSegments, activeClockDef);
            const allPassed = totalValidation.every(r => r.passed);
            const finalMsg = allPassed ? "VICTORY!" : "DEFEAT!";
            setSystemMessage(finalMsg);
            
            const newState = { 
                ...gameStateRef.current, 
                systemMessage: finalMsg 
            };
            gameStateRef.current = newState;
            broadcastState(newState);
        }
    }
  }, [phase, resolutionStep, clockSegments]);

  // --- Copy Helper ---
  const copyToClipboard = (text: string) => {
    if (!navigator.clipboard) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setFeedback("Copied!");
        setTimeout(() => setFeedback(""), 2000);
    } else {
        navigator.clipboard.writeText(text).then(() => {
            setFeedback("Copied!");
            setTimeout(() => setFeedback(""), 2000);
        });
    }
  };

  // --- Render ---

  const myPlayer = players.find(p => p.id === myPlayerId);
  const faceUpLimit = players.length;
  const isMyTurn = players[currentPlayerIndex]?.id === myPlayerId;
  const inviteLink = myPeerId ? `${window.location.origin}${window.location.pathname}?lobby=${myPeerId}` : '';

  if (phase === ExtendedGamePhase.LOBBY) {
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
                              <label className="block text-sm text-gray-400 mb-1">Total Players</label>
                              <div className="flex gap-2">
                                  <button onClick={() => setPlayerCountSetting(3)} className={`flex-1 py-2 rounded border ${playerCountSetting===3 ? 'border-gold bg-gold bg-opacity-20' : 'border-gray-600'}`}>3</button>
                                  <button onClick={() => setPlayerCountSetting(4)} className={`flex-1 py-2 rounded border ${playerCountSetting===4 ? 'border-gold bg-gold bg-opacity-20' : 'border-gray-600'}`}>4</button>
                              </div>
                          </div>
                          
                          <div className="bg-black bg-opacity-30 p-4 rounded text-center">
                              <p className="text-xs text-gray-500 uppercase mb-2">Share Link</p>
                              <div className="flex items-center gap-2">
                                  <input readOnly value={inviteLink} className="flex-1 bg-transparent text-gold font-mono text-sm border-none outline-none text-ellipsis" />
                                  <button onClick={() => copyToClipboard(inviteLink)} className="bg-gray-700 px-3 py-1 rounded text-xs hover:bg-gray-600 font-bold border border-gray-600">Copy</button>
                              </div>
                          </div>
                          
                          <div className="text-sm text-gray-400 border-t border-gray-700 pt-2">
                             <div className="font-bold mb-1">Lobby Members:</div>
                             <ul className="list-disc pl-5">
                                 <li className="text-gold">{myName} (You)</li>
                                 {connectedPeersList.map((p,i) => <li key={i} className="text-white">{p.name}</li>)}
                             </ul>
                             <p className="text-xs mt-2 italic">Remaining slots will be filled by Bots.</p>
                          </div>

                          <div className="border-t border-gray-700 pt-4">
                              <h3 className="text-gold mb-2">Select Mission:</h3>
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
                              <label className="block text-sm text-gray-400 mb-1">Lobby Code</label>
                              <input 
                                className="w-full bg-void border border-gray-600 p-2 rounded font-mono text-center uppercase tracking-widest"
                                placeholder="Paste Code Here"
                                value={targetLobbyId}
                                onChange={(e) => setTargetLobbyId(e.target.value)}
                              />
                          </div>
                          <button onClick={() => connectToHost(targetLobbyId)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded">
                              CONNECT
                          </button>
                          {targetLobbyId && (
                              <div className="text-xs text-center text-gray-500 animate-pulse">
                                  {feedback || "Ready to connect..."}
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      );
  }

  // Common hand rendering logic
  const renderHand = (dimmed: boolean = false) => (
      <div className={`w-full max-w-5xl flex items-center justify-between gap-4 ${dimmed ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
         <div className="flex flex-col items-start gap-2">
             <div className="text-sm font-bold text-gold">
                {dimmed ? "WAITING..." : (isMyTurn ? "YOUR TURN" : `${players[currentPlayerIndex]?.name}'s Turn`)}
             </div>
             <label className={`flex items-center gap-2 cursor-pointer transition-opacity ${(!selectedCardId || faceUpTokensUsed >= faceUpLimit || !isMyTurn || dimmed) ? 'opacity-50 cursor-not-allowed' : 'opacity-100'}`}>
                 <div className={`w-6 h-6 rounded border flex items-center justify-center ${playFaceUp ? 'bg-gold border-gold' : 'border-gray-500'}`}>
                     {playFaceUp && <span className="text-black text-xs">✓</span>}
                 </div>
                 <input type="checkbox" className="hidden" checked={playFaceUp} onChange={e => setPlayFaceUp(e.target.checked)} disabled={!selectedCardId || faceUpTokensUsed >= faceUpLimit || !isMyTurn || dimmed} />
                 <span className="text-sm">Play Face Up</span>
             </label>
         </div>

         <div className="flex -space-x-2 md:space-x-4 overflow-visible px-4 py-2">
             {myPlayer!.hand.map(card => (
                 <CardComponent 
                    key={card.id} 
                    card={card} 
                    onClick={() => handleCardSelect(card.id)}
                    selected={selectedCardId === card.id}
                 />
             ))}
         </div>
     </div>
  );

  return (
    <div className="min-h-screen bg-void text-parchment font-sans selection:bg-gold selection:text-void flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-3 bg-void-light shadow-md z-10">
            <div className="flex items-center gap-4">
               <h2 className="text-xl font-serif text-gold hidden md:block">{activeClockDef.name}</h2>
               {/* Move Counter */}
               {phase === ExtendedGamePhase.PLACEMENT && (
                   <div className="bg-gray-800 border border-gray-600 px-3 py-1 rounded text-sm text-gray-300">
                       Move <span className="text-gold font-bold">#{cardsPlayedCount + 1}</span>
                   </div>
               )}

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
                        {/* Improved Hand Visualization: Solar vs Lunar */}
                        <div className="flex -space-x-1 mt-1">
                            {p.hand.map((card, idx) => (
                                <div 
                                    key={idx} 
                                    className={`w-2 h-3 rounded-sm border border-black ${card.type === CardType.SOLAR ? 'bg-gold' : 'bg-indigo-500'}`}
                                    title={card.type === CardType.SOLAR ? 'Solar' : 'Lunar'}
                                ></div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="text-right flex items-center gap-4">
                <div>
                    <div className="text-xs text-gray-400">Face Up</div>
                    <div className={`font-bold ${faceUpTokensUsed>=faceUpLimit ? 'text-red-400' : 'text-green-400'}`}>
                        {faceUpTokensUsed}/{faceUpLimit}
                    </div>
                </div>
                {isHost && (
                    <div className="flex gap-2">
                        <button onClick={forceSync} className="bg-blue-900 border border-blue-500 text-xs px-2 py-1 rounded hover:bg-blue-800" title="Force Resync">
                            ↻
                        </button>
                        <button onClick={abortGame} className="bg-red-900 border border-red-500 text-xs px-2 py-1 rounded hover:bg-red-800" title="Abort Game">
                            ✖
                        </button>
                    </div>
                )}
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
            {/* Local Feedback */}
            {feedback && (
                <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-90 border border-gold px-6 py-2 rounded-full text-lg animate-pulse z-50 whitespace-nowrap pointer-events-none">
                    {feedback}
                </div>
            )}
            {/* Global System Message (Victory/Defeat/Starts) */}
            {systemMessage && (
                <div className="absolute top-32 left-1/2 transform -translate-x-1/2 bg-indigo-900 bg-opacity-95 border-2 border-gold px-8 py-4 rounded-xl text-2xl font-serif text-gold shadow-2xl z-50 whitespace-nowrap pointer-events-none animate-bounce">
                    {systemMessage}
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
            {myPlayer && (
                <>
                    {phase === ExtendedGamePhase.PLACEMENT && renderHand(false)}
                    {phase === ExtendedGamePhase.START_PLAYER_SELECTION && (
                        <div className="flex flex-col items-center">
                            <div className="text-center text-parchment animate-pulse mb-4">
                                Decide who goes first, then click "I Start" above!
                            </div>
                            {/* Show hand dimmed so user knows they have cards */}
                            {renderHand(true)} 
                        </div>
                    )}
                </>
            )}
        </div>
    </div>
  );
};

export default App;