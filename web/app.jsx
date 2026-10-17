import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const money = (value) => {
  if (value === undefined || value === null) return '—';
  const [whole, decimal = '00'] = String(value).split('.');
  try {
    return `${BigInt(whole).toLocaleString()}.${(decimal + '00').slice(0, 2)}`;
  } catch {
    return '—';
  }
};
const multiplyMoney = (value, multiplier) => {
  const [whole, decimal = '00'] = String(value || '0').split('.');
  return (BigInt(whole) * 100n + BigInt((decimal + '00').slice(0, 2))) * BigInt(multiplier);
};
const minorUnitsToMoney = (minorUnits) => {
  const value = BigInt(minorUnits);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole.toLocaleString()}.${fraction}`;
};
const telegramWebApp = () => window.Telegram?.WebApp;
const MAX_CARTELAS_PER_PLAYER = 2;
let audioUnlocked = false;
let audioUnlockInFlight = false;
const callAudio = typeof Audio !== 'undefined' ? new Audio() : null;
if (callAudio) {
  callAudio.preload = 'auto';
  callAudio.playsInline = true;
}
function unlockAudio() {
  if (audioUnlocked || audioUnlockInFlight || !callAudio) return;
  const unlockSource = '/audio/amharic/1.mp3?v=3';
  audioUnlockInFlight = true;
  callAudio.volume = 0;
  callAudio.onerror = null;
  callAudio.src = unlockSource;
  callAudio.load();
  callAudio.play().then(() => {
    audioUnlocked = true;
    if (callAudio.src.endsWith(unlockSource)) {
      callAudio.pause();
      callAudio.currentTime = 0;
      callAudio.removeAttribute('src');
      callAudio.load();
      callAudio.volume = 1;
    }
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }).catch((error) => {
    if (callAudio.src.endsWith(unlockSource)) {
      callAudio.pause();
      callAudio.removeAttribute('src');
      callAudio.load();
      callAudio.volume = 1;
    }
    audioUnlockInFlight = false;
    console.warn('[Audio unlock failed]:', error.message);
  });
}
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio, { passive: true });
const amharicNumbers = [
  '', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ',
  'አስር', 'አስራ አንድ', 'አስራ ሁለት', 'አስራ ሶስት', 'አስራ አራት',
  'አስራ አምስት', 'አስራ ስድስት', 'አስራ ሰባት', 'አስራ ስምንት', 'አስራ ዘጠኝ',
];
const amharicNumberWords = (number) => {
  if (number < 20) return amharicNumbers[number] || String(number);
  const tens = ['', '', 'ሃያ', 'ሰላሳ', 'አርባ', 'ሃምሳ', 'ስልሳ', 'ሰባ'];
  const remainder = number % 10;
  return remainder ? `${tens[Math.floor(number / 10)]} ${amharicNumbers[remainder]}` : tens[Math.floor(number / 10)];
};
const amharicCallText = (number) => {
  const letter = number <= 15 ? 'ቢ'
    : number <= 30 ? 'አይ'
      : number <= 45 ? 'ኤን'
        : number <= 60 ? 'ጂ' : 'ኦ';
  return `${letter} ${amharicNumberWords(number)}`;
};
function playAmharicBall(ballNumber, soundEnabled, onBlocked) {
  if (!soundEnabled || !ballNumber || !callAudio) return;
  try {
    callAudio.pause();
    callAudio.currentTime = 0;
    callAudio.src = `/audio/amharic/${ballNumber}.mp3?v=3`;
    callAudio.volume = 1;
    callAudio.load();
    callAudio.play().catch((error) => {
      console.warn(`[Amharic audio play blocked for #${ballNumber}]:`, error.message);
      onBlocked?.(error);
    });
  } catch (error) {
    console.error('[Amharic audio engine error]:', error);
  }
}
const gameWithClockOffset = (game, requestStartedAt, responseReceivedAt = Date.now()) => game
  ? {
    ...game,
    clientClockOffset: Number(game.serverNow) - (requestStartedAt + responseReceivedAt) / 2,
  }
  : null;

function parseNumberList(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(Number).filter((number) => Number.isInteger(number) && number >= 1 && number <= 75);
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React Crash Caught]:', error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack || '' });
  }

  render() {
    if (this.state.hasError) {
      const { error, componentStack } = this.state;
      return <div style={{ padding: 20, color: '#ef4444', background: '#0f0920', minHeight: '100dvh', fontFamily: 'sans-serif', overflow: 'auto' }}>
        <h3>⚠️ {this.props.title || 'App render error'}</h3>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, color: '#fca5a5' }}>
          {error?.toString()}
          {error?.stack ? `\n\n${error.stack}` : ''}
          {componentStack ? `\n\nReact component stack:${componentStack}` : ''}
        </pre>
        <button onClick={() => window.location.reload()} style={{ marginTop: 15, padding: '8px 16px', background: '#f59e0b', border: 'none', borderRadius: 6, fontWeight: 'bold' }}>
          Reload App
        </button>
      </div>;
    }
    return this.props.children;
  }
}

const words = {
  en: {
    play: 'Play', ranks: 'Ranks', history: 'History', profile: 'Profile', settings: 'Settings', welcome: 'Play. Win. Enjoy!',
    balance: 'Balance', refresh: 'Refresh', rooms: 'Available room', roomEmpty: 'No waiting rooms are open right now.',
    retry: 'Retry', join: 'JOIN +', cards: 'Select cartelas', available: 'Available', selected: 'Yours',
    taken: 'Taken', count: 'Selected', stake: 'Cost per cartela', total: 'Total', selectHelp: 'Tap an available cartela to select it immediately. Choose up to two.',
    back: 'Back', game: 'Bingo game', recent: 'Recent calls', callBoard: 'Number board', leave: 'Leave room',
    noHistory: 'No game history yet.', noRanks: 'Rankings will appear after completed games.',
    deposit: 'Deposit', withdraw: 'Withdraw', share: 'Share invite', copy: 'Copy invite link',
    support: 'Support', language: 'Language', unavailable: 'Unavailable', loading: 'Loading…',
    rules: 'One Line or Four Corners. FREE center is marked automatically.',
    roomsUnavailable: 'Could not load rooms.', dataUnavailable: 'Could not load this data.',
    realtime: 'REAL-TIME', multipleRooms: 'MULTIPLE ROOMS', instantRewards: 'INSTANT REWARDS',
    stakeTitle: 'Stake', stakePitch: 'Play with your stake and win big!', enterGame: 'Enter Game',
    stakeAmount: 'STAKE AMOUNT', playersLabel: 'PLAYERS', statusLabel: 'STATUS',
    waiting: 'WAITING', selecting: 'SELECTING', playing: 'PLAYING', playSmart: 'PLAY SMART',
    playSmartHint: 'Choose up to 2 cartelas. Each cartela costs {amount} BIRR.',
    howToPlay: 'HOW TO PLAY', pickRoom: 'Pick a room', chooseCards: 'Choose cards', autoMarkWin: 'Auto-mark & win',
    round: 'ROUND', pot: 'POT', called: 'CALLED', currentBall: 'CURRENT BALL', watchingLive: 'Watching live',
    callsSynced: 'Calls are synchronized for everyone.', auto: 'Auto', sound: 'Sound',
    bingo: '📣 BINGO!', claimingBingo: 'Verifying…', marked: 'MARKED',
    roomMetrics: 'Room metrics', cartelaSelection: 'Choose a cartela', selectedCartelas: 'Selected cartela previews',
    cartela: 'Cartela', startingIn: 'STARTS IN',
    selectPreview: 'Select up to 2 cartelas to preview', roomSummary: 'Room summary',
    cartelaClosed: 'This room no longer accepts cartela changes.', cartelaLoadFailed: 'Could not load all 100 cartelas ({count}/100).',
    maximumCartelas: 'Maximum 2 cartelas allowed', insufficientBalance: 'Insufficient balance.',
    backToRooms: 'Back to rooms', roomStatus: "You're in the room",
    waitingPlayers: 'Waiting for players to choose their cartelas. The game starts when {count} players have selected a cartela.',
    yourCartelas: 'YOUR CARTELAS', prizePool: 'PRIZE POOL', manageCartelas: 'Manage cartelas',
    leaveRefund: 'Leave room & refund', currentCalls: 'CURRENT BALL', recentCalls: 'RECENT',
    gameRound: 'ROOM', playersCount: 'PLAYERS', stakeLabel: 'STAKE', freeSpace: 'Free space',
    gameOver: 'GAME OVER', winnerHeadline: 'BINGO!', multiWinners: '{count} players won! 🎉',
    singleWinner: 'We have a winner! 🎉', noWinner: 'The game ended without a winning cartela.',
    winningCartela: 'WINNING CARTELA #{number}', claimedCartela: 'CLAIMED CARTELA #{number}', calls: 'CALLS', verified: '✓ Verified',
    nextRound: 'Next round in {seconds}s...', playerProfile: 'PLAYER PROFILE',
    gamesWon: 'Games won', winnings: 'Winnings', winRate: 'Win rate', referrals: 'Referrals',
    successfulReferrals: 'Successful referrals:',
    availableBalance: 'Available balance', paymentMethod: 'Payment method', amountBirr: 'Amount (BIRR)',
    transactionReference: 'Transaction reference', submitApproval: 'Submit for approval',
    paymentUnconfigured: 'Payment methods are not configured.',
    minWithdrawal: 'Minimum withdrawal: 50.00 BIRR. Requests reserve funds while an administrator reviews the payout.',
    accountDetails: 'Phone/account details', room: 'Room', wins: 'wins', you: '(You)',
    destinationName: 'Destination name (account holder)',
    settingsTitle: 'Settings', rulesTitle: 'Rules',
    shareAndInvite: 'Share invite', shareAction: 'Share', sharedWallet: 'SHARED WALLET',
    youWon: 'You', historyRoom: 'Room #{id}', cartelasLabel: 'Cartelas:',
    stakeLabelInHistory: 'Stake:', patternLabel: 'Pattern:',
    depositOptionsMissing: 'Payment methods are not configured.',
    noRoomsHelp: 'New rooms will appear here when opened.',
    cartelaNumberTitle: 'Cartela #{number}', playerFallback: 'Player',
    winnerPot: '💰 {amount} BIRR Pot', inviteCopied: 'Invite link copied.',
    playerId: 'ID', languageEnglish: 'English', languageAmharic: 'Amharic',
    depositSubmitted: 'Deposit request #{id} submitted; admin approval is required.',
    withdrawalSubmitted: 'Withdrawal request #{id} submitted for admin review.',
    shareFailed: 'Could not share the invite link.', currency: 'BIRR',
    winnerRoom: 'ROOM #{number}', roomNumber: 'ROOM #{number}', free: 'FREE', freeSpaceLabel: 'Free space',
    cartelaCellNumber: 'Number {number}', markedCell: 'marked',
    roomsLoadHelp: 'New rooms will appear here when opened.',
    claimVerified: '✓ Verified', roomStatusWaiting: 'WAITING', roomStatusSelecting: 'SELECTING',
    roomStatusPlaying: 'PLAYING', languageSaved: 'Language updated.',
  },
  am: {
    play: 'ጨዋታ', ranks: 'ደረጃ', history: 'ታሪክ', profile: 'መገለጫ', settings: 'ቅንብሮች', welcome: 'ይጫወቱ። ያሸንፉ። ይደሰቱ!',
    balance: 'ቀሪ ሂሳብ', refresh: 'አድስ', rooms: 'ያሉ ክፍሎች', roomEmpty: 'አሁን የሚጠባበቅ ክፍል የለም።',
    retry: 'እንደገና ሞክር', join: 'ወደ ክፍል ግባ', cards: 'ካርቴላ ይምረጡ', available: 'ያለ', selected: 'የእርስዎ', taken: 'ተይዟል',
    count: 'የተመረጡ', stake: 'የአንድ ካርቴላ ዋጋ', total: 'ጠቅላላ', selectHelp: 'ያለ ካርቴላ ወዲያውኑ ለመምረጥ ይንኩ። እስከ ሁለት ይምረጡ።',
    back: 'ተመለስ', game: 'የቢንጎ ጨዋታ', recent: 'የቅርብ ጥሪዎች', callBoard: 'ቁጥር ሰሌዳ', leave: 'ከክፍሉ ውጣ',
    noHistory: 'ገና የጨዋታ ታሪክ የለም።', noRanks: 'ጨዋታዎች ሲጠናቀቁ ደረጃዎች ይታያሉ።',
    deposit: 'ገንዘብ አስገባ', withdraw: 'ገንዘብ አውጣ', share: 'ግብዣ አጋራ', copy: 'የግብዣ አገናኝ ቅዳ',
    support: 'ድጋፍ', language: 'ቋንቋ', unavailable: 'አልተገኘም', loading: 'በመጫን ላይ…',
    rules: 'አንድ መስመር ወይም አራት ማዕዘኖች። የመሃል FREE ቦታ በራስ-ሰር ይምረጣል።',
    roomsUnavailable: 'ክፍሎችን መጫን አልተቻለም።', dataUnavailable: 'መረጃውን መጫን አልተቻለም።',
    realtime: 'በቀጥታ', multipleRooms: 'ብዙ ክፍሎች', instantRewards: 'ፈጣን ሽልማቶች',
    stakeTitle: 'ውርርድ', stakePitch: 'በውርርድዎ ይጫወቱና ትልቅ ያሸንፉ!', enterGame: 'ወደ ጨዋታ ግባ',
    stakeAmount: 'የውርርድ መጠን', playersLabel: 'ተጫዋቾች', statusLabel: 'ሁኔታ',
    waiting: 'በመጠባበቅ ላይ', selecting: 'በምርጫ ላይ', playing: 'በጨዋታ ላይ', playSmart: 'በጥበብ ይጫወቱ',
    playSmartHint: 'እስከ 2 ካርቴላ ይምረጡ። እያንዳንዱ ካርቴላ {amount} ብር ነው።',
    howToPlay: 'እንዴት መጫወት ይቻላል', pickRoom: 'ክፍል ይምረጡ', chooseCards: 'ካርዶችን ይምረጡ', autoMarkWin: 'በራስ-ሰር ምልክት እና አሸንፍ',
    round: 'ዙር', pot: 'ሽልማት', called: 'የተጠሩ', currentBall: 'አሁን የወጣ ቁጥር', watchingLive: 'በቀጥታ እየተመለከቱ ነው',
    callsSynced: 'ጥሪዎቹ ለሁሉም ተጫዋቾች ተመሳስለዋል።', auto: 'በራስ-ሰር', sound: 'ድምፅ',
    bingo: '📣 ቢንጎ!', claimingBingo: 'በማረጋገጥ ላይ…', marked: 'ምልክት የተደረገባቸው',
    roomMetrics: 'የክፍል መረጃ', cartelaSelection: 'ካርቴላ ይምረጡ', selectedCartelas: 'የተመረጡ ካርቴላዎች',
    cartela: 'ካርቴላ', startingIn: 'ይጀምራል በ',
    selectPreview: 'ለማየት እስከ 2 ካርቴላ ይምረጡ', roomSummary: 'የክፍል ማጠቃለያ',
    cartelaClosed: 'ይህ ክፍል ካርቴላ መቀየርን አይቀበልም።', cartelaLoadFailed: '100 ካርቴላዎችን መጫን አልተቻለም ({count}/100)።',
    maximumCartelas: 'ከፍተኛው 2 ካርቴላ ብቻ ነው።', insufficientBalance: 'በቂ ቀሪ ሂሳብ የለም።',
    backToRooms: 'ወደ ክፍሎች ተመለስ', roomStatus: 'ወደ ክፍሉ ገብተዋል',
    waitingPlayers: 'ተጫዋቾች ካርቴላ እስኪመርጡ ይጠብቁ። {count} ተጫዋቾች ካርቴላ ሲመርጡ ጨዋታው ይጀምራል።',
    yourCartelas: 'የእርስዎ ካርቴላዎች', prizePool: 'ጠቅላላ ሽልማት', manageCartelas: 'ካርቴላዎችን ያስተዳድሩ',
    leaveRefund: 'ከክፍሉ ይውጡ እና ገንዘቡን ይመልሱ', currentCalls: 'አሁን የወጣ ቁጥር', recentCalls: 'የቅርብ ጊዜ',
    gameRound: 'ክፍል', playersCount: 'ተጫዋቾች', stakeLabel: 'ውርርድ', freeSpace: 'ነፃ ቦታ',
    gameOver: 'ጨዋታው ተጠናቋል', winnerHeadline: 'ቢንጎ!', multiWinners: '{count} ተጫዋቾች አሸንፈዋል! 🎉',
    singleWinner: 'አሸናፊ አለን! 🎉', noWinner: 'አሸናፊ ካርቴላ ሳይኖር ጨዋታው ተጠናቋል።',
    winningCartela: 'አሸናፊ ካርቴላ #{number}', claimedCartela: 'የቀረበው ካርቴላ #{number}', calls: 'ጥሪዎች', verified: '✓ ተረጋግጧል',
    nextRound: 'ቀጣዩ ዙር በ{seconds} ሰከንድ...', playerProfile: 'የተጫዋች መገለጫ',
    gamesWon: 'ያሸነፉ ጨዋታዎች', winnings: 'ያሸነፉት', winRate: 'የማሸነፍ መጠን', referrals: 'ግብዣዎች',
    inviteCopied: 'የግብዣ አገናኙ ተቀድቷል።', successfulReferrals: 'የተሳኩ ግብዣዎች:',
    availableBalance: 'ያለው ቀሪ ሂሳብ', paymentMethod: 'የክፍያ ዘዴ', amountBirr: 'መጠን (ብር)',
    transactionReference: 'የግብይት ማጣቀሻ', submitApproval: 'ለማጽደቅ አስገባ',
    paymentUnconfigured: 'የክፍያ ዘዴዎች አልተዋቀሩም።',
    minWithdrawal: 'ዝቅተኛ የማውጣት መጠን፦ 50.00 ብር። አስተዳዳሪው እስኪገመግም ገንዘቡ ይያዛል።',
    accountDetails: 'ስልክ/የሂሳብ ዝርዝር', room: 'ክፍል', wins: 'አሸንፈዋል', you: '(እርስዎ)',
    destinationName: 'የተቀባይ ስም (የሂሳብ ባለቤት)',
    settingsTitle: 'ቅንብሮች', rulesTitle: 'ህጎች',
    shareAndInvite: 'ግብዣ አጋራ', shareAction: 'አጋራ', sharedWallet: 'የጋራ ቦርሳ',
    youWon: 'እርስዎ', historyRoom: 'ክፍል #{id}', cartelasLabel: 'ካርቴላዎች:',
    stakeLabelInHistory: 'ውርርድ:', patternLabel: 'ቅርጽ:',
    depositOptionsMissing: 'የክፍያ ዘዴዎች አልተዋቀሩም።',
    noRoomsHelp: 'አዳዲስ ክፍሎች ሲከፈቱ እዚህ ይታያሉ።',
    cartelaNumberTitle: 'ካርቴላ #{number}', playerFallback: 'ተጫዋች',
    winnerPot: '💰 {amount} ብር ሽልማት',
    playerId: 'መለያ', languageEnglish: 'እንግሊዝኛ', languageAmharic: 'አማርኛ',
    depositSubmitted: 'የተቀማጭ ጥያቄ #{id} ተልኳል፤ የአስተዳዳሪ ማጽደቅ ያስፈልጋል።',
    withdrawalSubmitted: 'የማውጣት ጥያቄ #{id} ለአስተዳዳሪ ግምገማ ተልኳል።',
    shareFailed: 'የግብዣ አገናኙን ማጋራት አልተቻለም።', currency: 'ብር',
    winnerRoom: 'ክፍል #{number}', roomNumber: 'ክፍል #{number}', free: 'ነፃ', freeSpaceLabel: 'ነፃ ቦታ',
    cartelaCellNumber: 'ቁጥር {number}', markedCell: 'ምልክት የተደረገ',
    noRoomsTitle: 'አሁን የሚጠባበቅ ክፍል የለም።',
    roomsLoadHelp: 'አዳዲስ ክፍሎች ሲከፈቱ እዚህ ይታያሉ።', refreshRoom: 'ክፍሉን አድስ',
    claimVerified: '✓ ተረጋግጧል', roomStatusWaiting: 'በመጠባበቅ ላይ',
    roomStatusSelecting: 'በምርጫ ላይ', roomStatusPlaying: 'በጨዋታ ላይ', languageSaved: 'ቋንቋው ተቀይሯል።',
  },
};

async function api(path, { method = 'GET', body, initData, allowAnonymous = false, signal, cache } = {}) {
  if (!initData && !allowAnonymous) throw new Error('Open this Mini App from Telegram to authenticate.');
  const response = await fetch(path, {
    method,
    headers: {
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
    ...(cache ? { cache } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestId = data.requestId || response.headers.get('x-request-id');
    const message = data.error || `Request failed (${response.status}).`;
    const error = new Error(requestId ? `${message} (Reference: ${requestId})` : message);
    error.status = response.status;
    error.code = data.code;
    error.requestId = requestId;
    throw error;
  }
  return data;
}

function withRoomClock(room) {
  if (!room?.countdown) return room;
  return {
    ...room,
    countdown: {
      ...room.countdown,
      clientOffset: Number(room.countdown.serverNow) - Date.now(),
    },
  };
}

function App() {
  const [lang, setLang] = useState('en');
  const t = words[lang];
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const callAudioRef = useRef(callAudio);
  const [rooms, setRooms] = useState([]);
  const [myRoomId, setMyRoomId] = useState(null);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [view, setView] = useState('play');
  const [room, setRoom] = useState(null);
  const [roomReady, setRoomReady] = useState(false);
  const roomStateRevision = useRef(0);
  const roomSessionRevision = useRef(0);
  const finishedRoomId = useRef(null);
  const claimRequestInFlight = useRef(false);
  const selectionMutationQueue = useRef(Promise.resolve());
  const activeSelectionMutations = useRef(0);
  const [game, setGame] = useState(null);
  const [pendingBingoClaim, setPendingBingoClaim] = useState(null);
  const lastGameCall = useRef({ roomId: null, number: null, callIndex: 0 });
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [referral, setReferral] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [initData, setInitData] = useState('');
  const [telegramDiagnostic, setTelegramDiagnostic] = useState('');
  const [telegramChecked, setTelegramChecked] = useState(false);

  const request = useCallback((path, options) => api(path, { ...options, initData }), [initData]);
  const refreshWallet = useCallback(async () => {
    try {
      const data = await request('/api/me');
      setUser(data.user);
      setWallet(data.wallet.balance);
      setLang(data.user.language === 'am' ? 'am' : 'en');
    } catch (reason) {
      console.warn('[Balance refresh skipped]:', reason);
      throw reason;
    }
  }, [request]);

  const refreshRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const data = await api('/api/rooms', { initData, allowAnonymous: true });
      setRooms(data.rooms);
      setMyRoomId(data.myRoom ? String(data.myRoom) : null);
      return data;
    } finally {
      setRoomsLoading(false);
    }
  }, [initData]);

  const loadRoom = useCallback(async (id, sessionRevision = roomSessionRevision.current, signal, { onlyReconnect = false } = {}) => {
    const requestStartedAt = Date.now();
    const data = await request(`/api/rooms/${encodeURIComponent(id)}/state`, { signal });
    if (sessionRevision !== roomSessionRevision.current) return data;
    const roomId = String(id);
    const isFinished = data.room.status === 'FINISHED' || data.game?.status === 'FINISHED';
    if (onlyReconnect && (data.room.status !== 'PLAYING'
      || !data.room.cartelas?.some((card) => card.state === 'MINE'))) return data;
    if (claimRequestInFlight.current && !isFinished) return data;
    if (finishedRoomId.current === roomId && !isFinished) return data;
    if (isFinished) {
      finishedRoomId.current = String(id);
    } else if (finishedRoomId.current !== roomId) {
      finishedRoomId.current = null;
    }
    setRoom(withRoomClock(data.room));
    setRoomReady(true);
    setGame(gameWithClockOffset(data.game, requestStartedAt));
    if (data.wallet?.availableBalance !== undefined) {
      setWallet(data.wallet.availableBalance);
    }
    const hasPendingWinner = data.room.status === 'VERIFYING'
      && (data.winners?.length || data.game?.winners?.length);
    setView(data.room.status === 'FINISHED' || hasPendingWinner
      ? 'winner'
      : ['PLAYING', 'VERIFYING'].includes(data.room.status) ? 'game' : 'cartelas');
    return data;
  }, [request]);

  function submitBingoClaim(numbers, cartelaNumber, claimedNumbers) {
    if (!room?.id || !numbers.length) throw new Error('No winning cartela is available to claim.');
    const roomId = String(room.id);
    claimRequestInFlight.current = true;
    setPendingBingoClaim({
      roomId,
      cartelaNumber: Number(cartelaNumber ?? numbers[0]),
      displayName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Player',
      username: user?.username || null,
      countdownDeadline: Date.now() + 7000,
    });
    setGame((current) => current ? {
      ...current,
      calledNumbers: claimedNumbers,
      currentNumber: claimedNumbers.at(-1) ?? current.currentNumber,
      callIndex: claimedNumbers.length,
    } : current);
    setRoom((current) => current && String(current.id) === roomId
      ? { ...current, status: 'VERIFYING' }
      : current);
    setView('winner');
    setBusy(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const submit = async () => {
      try {
        const retryDeadline = Date.now() + Math.min(
          Math.max(Number(game?.callIntervalMs || 4000) + 500, 1500),
          8000,
        );
        let result;
        while (!result) {
          try {
            result = await request(`/api/rooms/${encodeURIComponent(roomId)}/bingo`, {
              method: 'POST',
              body: {},
              signal: controller.signal,
            });
          } catch (reason) {
            if (reason.code !== 'NO_VALID_BINGO' || Date.now() >= retryDeadline) throw reason;
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
        if (result.success !== true || result.accepted !== true) {
          throw new Error(result.error || 'Bingo claim was not accepted.');
        }
        finishedRoomId.current = roomId;
        const called = Array.isArray(result.calledNumbers) ? result.calledNumbers : claimedNumbers;
        setRoom((current) => current && String(current.id) === roomId
          ? { ...current, status: 'FINISHED', finishedAt: result.finishedAt ?? current.finishedAt }
          : current);
        setGame((current) => current ? {
          ...current,
          status: 'FINISHED',
          finishedAt: result.finishedAt ?? current.finishedAt,
          calledNumbers: called,
          currentNumber: called.at(-1) ?? current.currentNumber,
          callIndex: called.length,
          winners: result.winners || (result.winner ? [result.winner] : []),
        } : current);
        setPendingBingoClaim(null);
        setView('winner');
      } catch (reason) {
        console.warn('[Bingo claim failed]:', reason);
        const refreshController = new AbortController();
        const refreshTimeout = window.setTimeout(() => refreshController.abort(), 2500);
        try {
          const requestStartedAt = Date.now();
          const latest = await request(`/api/rooms/${encodeURIComponent(roomId)}/state`, {
            signal: refreshController.signal,
          });
          setRoom(withRoomClock(latest.room));
          setGame(gameWithClockOffset(latest.game, requestStartedAt));
          if (latest.room.status === 'FINISHED' || latest.game?.status === 'FINISHED') {
            finishedRoomId.current = roomId;
            setPendingBingoClaim(null);
            if (latest.room.status !== 'FINISHED') {
              setRoom((current) => current && String(current.id) === roomId
                ? { ...current, status: 'FINISHED' }
                : current);
            }
            setView('winner');
          } else if ((reason.status && reason.status < 500) || latest.room.status === 'PLAYING'
            || !['PLAYING', 'VERIFYING'].includes(latest.room.status)) {
            setPendingBingoClaim(null);
            setView('game');
            const telegram = telegramWebApp();
            if (telegram?.showAlert) telegram.showAlert(reason.message || 'Bingo verification failed.');
            else window.alert(reason.message || 'Bingo verification failed.');
          }
        } catch (refreshError) {
          console.warn('[Bingo claim state refresh failed]:', refreshError);
        } finally {
          window.clearTimeout(refreshTimeout);
        }
      } finally {
        claimRequestInFlight.current = false;
        window.clearTimeout(timeout);
        setBusy(false);
      }
    };
    void submit();
  }

  useEffect(() => {
    let active = true;
    let attempts = 0;
    const checkTelegram = () => {
      attempts += 1;
      const telegram = telegramWebApp();
      telegram?.ready();
      telegram?.expand();
      if (telegram?.initData) {
        if (active) {
          setInitData(telegram.initData);
          setTelegramChecked(true);
          setTelegramDiagnostic('');
        }
        return true;
      }
      if (attempts >= 20) {
        if (active) {
          setTelegramChecked(true);
          setTelegramDiagnostic(telegram
            ? `Telegram SDK detected (${telegram.platform || 'platform unknown'}, version ${telegram.version || 'unknown'}), but no launch data was provided. Close this window and reopen the Mini App from the bot menu.`
            : 'Telegram WebApp SDK was not detected. Open this Mini App from the bot menu inside Telegram.');
        }
        return true;
      }
      return false;
    };
    const poll = window.setInterval(() => {
      if (checkTelegram()) window.clearInterval(poll);
    }, 250);
    checkTelegram();
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const telegram = telegramWebApp();
    if (telegram?.BackButton) {
      telegram.BackButton.onClick(() => {
        if (view === 'game' || view === 'cartelas' || view === 'waiting') {
          setView('play');
          setRoom(null);
          setRoomReady(false);
          setGame(null);
          setBusy(false);
        } else if (view !== 'play') setView('play');
      });
      return () => telegram.BackButton.offClick();
    }
  }, [view]);

  useEffect(() => {
    let active = true;
    refreshRooms()
      .then((roomData) => {
        if (!active) return;
        if (initData) {
          setError('');
          const myRoom = roomData.rooms.find((item) => String(item.id) === String(roomData.myRoom));
          if (myRoom?.status === 'PLAYING') {
            loadRoom(roomData.myRoom, roomSessionRevision.current, undefined, { onlyReconnect: true })
              .catch((reason) => { if (active) setError(reason.message); });
          }
        } else if (telegramChecked) {
          setError(telegramDiagnostic);
        }
      })
      .catch((reason) => { if (active) setError(reason.message); });
    if (initData) refreshWallet().catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [initData, telegramChecked, telegramDiagnostic, refreshWallet, refreshRooms, loadRoom]);

  useEffect(() => {
    if (view !== 'play') return undefined;
    const timer = window.setInterval(() => {
      refreshRooms().catch((reason) => console.warn('[Lobby polling tick skipped]:', reason));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [initData, view, refreshRooms]);

  useEffect(() => {
    if (view !== 'cartelas' || !room?.id || !roomReady || !initData) return undefined;
    let active = true;
    let inFlight = false;
    const syncCartelas = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const data = await request(`/api/rooms/${encodeURIComponent(room.id)}/cartelas-sync`, { cache: 'no-store' });
        if (!active || !Array.isArray(data.cartelas)) return;
        const states = new Map(data.cartelas.map((card) => [Number(card.number), card.state]));
        setRoom((current) => {
          if (!current || String(current.id) !== String(room.id)) return current;
          let changed = false;
          const cartelas = current.cartelas.map((card) => {
            const state = states.get(Number(card.number)) || 'AVAILABLE';
            if (state === card.state) return card;
            changed = true;
            return { ...card, state };
          });
          return changed ? { ...current, cartelas } : current;
        });
      } catch (reason) {
        if (active) console.warn('[Cartela sync tick skipped]:', reason);
      } finally {
        inFlight = false;
      }
    };
    syncCartelas();
    const timer = window.setInterval(syncCartelas, 280);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [view, room?.id, roomReady, initData, request]);

  useEffect(() => {
    if (!initData) return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshWallet().catch((reason) => setError(reason.message));
      }
    };
    const timer = window.setInterval(refreshIfVisible, 10000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [initData, refreshWallet]);

  useEffect(() => {
    if (!room?.id || (!['cartelas', 'waiting', 'game'].includes(view)
      && !(view === 'winner' && (pendingBingoClaim || room.status === 'VERIFYING')))) return undefined;
    let active = true;
    let timer = null;
    let inFlight = false;
    const update = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      const revision = roomStateRevision.current;
      const requestStartedAt = Date.now();
      try {
        const data = await request(`/api/rooms/${encodeURIComponent(room.id)}/state`);
        const responseReceivedAt = Date.now();
        if (!active || revision !== roomStateRevision.current) return;
        const roomId = String(room.id);
        const isFinished = data.room.status === 'FINISHED' || data.game?.status === 'FINISHED';
        const hasPendingWinner = data.room.status === 'VERIFYING'
          && (data.winners?.length || data.game?.winners?.length);
        const shouldShowWinner = isFinished || Boolean(hasPendingWinner);
        if (claimRequestInFlight.current && !shouldShowWinner) return;
        if (finishedRoomId.current === roomId && !isFinished) return;
        const callIndex = Number(data.game?.callIndex) || 0;
        if (!isFinished && lastGameCall.current.roomId === roomId
          && callIndex < lastGameCall.current.callIndex) return;
        if (isFinished) finishedRoomId.current = roomId;
        const currentNumber = data.game?.currentNumber ?? null;
        if (lastGameCall.current.roomId === room.id
          && currentNumber !== null && lastGameCall.current.number !== null
          && currentNumber !== lastGameCall.current.number) {
          telegramWebApp()?.HapticFeedback?.impactOccurred?.('medium');
        }
        lastGameCall.current = { roomId, number: currentNumber, callIndex };
        setRoom(withRoomClock(data.room));
        setGame(gameWithClockOffset(data.game, requestStartedAt, responseReceivedAt));
        setWallet(data.wallet?.availableBalance ?? wallet);
        if (shouldShowWinner) {
          setPendingBingoClaim(null);
          if (isFinished && data.room.status !== 'FINISHED') {
            setRoom((current) => current && String(current.id) === String(room.id)
              ? { ...current, status: 'FINISHED' }
              : current);
          }
          setView('winner');
        } else if (pendingBingoClaim?.roomId === String(room.id)) {
          if (data.room.status === 'PLAYING' && !claimRequestInFlight.current) {
            setPendingBingoClaim(null);
            setView('game');
          }
        } else if (['PLAYING', 'VERIFYING'].includes(data.room.status)) {
          setView('game');
        }
      } catch (reason) {
        if (active) console.warn('[Polling tick skipped]:', reason);
      } finally {
        inFlight = false;
        if (active) timer = window.setTimeout(update, 750);
      }
    };
    void update();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [room?.id, room?.status, view, pendingBingoClaim, request]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (view === 'profile') {
          const [result, invite, info] = await Promise.all([
            request('/api/profile'), request('/api/referrals'), request('/api/app-info'),
          ]);
          if (active) {
            setProfile(result);
            setReferral(invite);
            setAppInfo(info);
          }
        } else if (view === 'history') {
          const result = await request('/api/history');
          if (active) setHistory([...(result.games || []), ...(result.transactions || [])]
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
        } else if (view === 'ranks') {
          const result = await request('/api/ranks');
          if (active) setRanks(result.ranks || []);
        }
      } catch (reason) {
        if (active) setError(reason.message);
      }
    };
    load();
    return () => { active = false; };
  }, [view, request]);

  const go = (next) => {
    setError('');
    setView(next);
    if (next === 'play') refreshRooms().catch((reason) => setError(reason.message));
  };

  function returnToLobby() {
    roomSessionRevision.current += 1;
    roomStateRevision.current += 1;
    finishedRoomId.current = null;
    setRoom(null);
    setRoomReady(false);
    setGame(null);
    setBusy(false);
    setView('play');
    Promise.all([refreshWallet(), refreshRooms()]).catch((reason) => console.warn('[Lobby refresh skipped]:', reason));
  }

  function resetRoomState({ keepCurrentView = false } = {}) {
    roomSessionRevision.current += 1;
    roomStateRevision.current += 1;
    if (!keepCurrentView) {
      setRoom(null);
      setRoomReady(false);
      setGame(null);
    }
    if (!keepCurrentView) setView('play');
    return roomSessionRevision.current;
  }

  function retryTelegramAuthentication() {
    const telegram = telegramWebApp();
    telegram?.ready();
    telegram?.expand();
    if (telegram?.initData) {
      setTelegramDiagnostic('');
      setInitData(telegram.initData);
      setError('');
      return;
    }
    setTelegramChecked(true);
    const diagnostic = telegram
      ? `Telegram SDK detected (${telegram.platform || 'platform unknown'}, version ${telegram.version || 'unknown'}), but no launch data was provided. Close this window and reopen the Mini App from the bot menu.`
      : 'Telegram WebApp SDK was not detected. Open this Mini App from the bot menu inside Telegram.';
    setTelegramDiagnostic(diagnostic);
    setError(diagnostic);
  }

  async function enterRoom(item, { keepCurrentView = false } = {}) {
    if (!initData) {
      setError('Open SHISHO BINGO from the Play button in the Telegram bot to authenticate and join.');
      return false;
    }
    const cachedRoom = String(item.id) === String(room?.id) && room?.cartelas?.length === 100
      ? room
      : null;
    if (String(item.id) !== String(room?.id)) finishedRoomId.current = null;
    const sessionRevision = resetRoomState({ keepCurrentView });
    setRoom(cachedRoom || withRoomClock({
      ...item,
      pot: item.pot ?? item.prizePool,
      cartelas: [],
    }));
    setRoomReady(Boolean(cachedRoom));
    if (!keepCurrentView) setView('cartelas');
    setBusy(true);
    setError('');
    try {
      const requestStartedAt = Date.now();
      const [data, me] = await Promise.all([
        request(`/api/rooms/${encodeURIComponent(item.id)}/join`, { method: 'POST', body: {} }),
        request('/api/me'),
      ]);
      const responseReceivedAt = Date.now();
      if (sessionRevision !== roomSessionRevision.current) return;
      roomStateRevision.current += 1;
      setRoom(withRoomClock(data.room));
      setRoomReady(true);
      setGame(gameWithClockOffset(data.game, requestStartedAt, responseReceivedAt));
      setWallet(me.wallet.availableBalance ?? me.wallet.balance ?? data.wallet.availableBalance);
      if (!data.spectator && data.room.status !== 'FINISHED') setMyRoomId(String(data.room.id));
      const hasCartelas = Array.isArray(data.room.cartelas)
        && data.room.cartelas.some((card) => card.state === 'MINE');
      const hasPendingWinner = data.room.status === 'VERIFYING'
        && (data.winners?.length || data.game?.winners?.length);
      if (data.room.status === 'FINISHED' || hasPendingWinner) {
        setView('winner');
      } else if (['PLAYING', 'VERIFYING'].includes(data.room.status)) {
        setView('game');
        if (!hasCartelas) console.info('[Room entry]: joining live game in spectator mode.');
      } else {
        setView(data.room.status === 'FINISHED' ? 'winner' : 'cartelas');
      }
      setError('');
      return true;
    } catch (reason) {
      try {
        await refreshRooms();
      } catch (refreshError) {
        console.warn('[Room entry and room refresh failed]:', reason, refreshError);
      }
      console.warn('[Room entry failed]:', reason);
      if (sessionRevision === roomSessionRevision.current) setError(reason.message);
      if (!keepCurrentView) setView('play');
      return false;
    } finally {
      if (sessionRevision === roomSessionRevision.current) setBusy(false);
    }
  }

  async function toggleCard(card, action) {
    if (!room || card.state === 'TAKEN' || !['select', 'deselect'].includes(action)) {
      throw new Error('This cartela is no longer available.');
    }
    const roomId = room.id;
    const sessionRevision = roomSessionRevision.current;
    activeSelectionMutations.current += 1;
    setBusy(true);
    const operation = selectionMutationQueue.current.then(async () => {
      if (sessionRevision !== roomSessionRevision.current) throw new Error('Room changed before the selection was saved.');
      roomStateRevision.current += 1;
      const requestStartedAt = Date.now();
      const data = await request(`/api/rooms/${encodeURIComponent(roomId)}/cartela`, {
        method: 'POST',
        body: { cartelaNumber: card.number, action },
      });
      if (sessionRevision === roomSessionRevision.current) {
        roomStateRevision.current += 1;
        setRoom(withRoomClock(data.room));
        setWallet(data.wallet.availableBalance);
        if (['PLAYING', 'VERIFYING'].includes(data.room.status)) {
          setGame(gameWithClockOffset(data.game, requestStartedAt));
          setView('game');
        }
      }
      return data;
    });
    selectionMutationQueue.current = operation.catch(() => {});
    try {
      return await operation;
    } catch (reason) {
      if (sessionRevision === roomSessionRevision.current) {
        const message = reason.message;
        try {
          await loadRoom(roomId, sessionRevision);
        } catch (refreshError) {
          console.warn('[Cartela rollback room refresh failed]:', message, refreshError);
        }
        try {
          await refreshWallet();
        } catch (refreshError) {
          console.warn('[Cartela rollback balance refresh failed]:', message, refreshError);
        }
      }
      throw reason;
    } finally {
      activeSelectionMutations.current -= 1;
      if (activeSelectionMutations.current === 0 && sessionRevision === roomSessionRevision.current) setBusy(false);
    }
  }

  async function leaveRoom() {
    if (!room || busy) return;
    if (room.status !== 'WAITING') {
      returnToLobby();
      return;
    }
    setBusy(true);
    try {
      await request(`/api/rooms/${encodeURIComponent(room.id)}/leave`, { method: 'POST', body: {} });
      roomSessionRevision.current += 1;
      roomStateRevision.current += 1;
      setRoom(null);
      setRoomReady(false);
      setGame(null);
      setView('play');
      await Promise.all([refreshWallet(), refreshRooms()]);
    } catch (reason) {
      console.warn('[Room leave failed]:', reason);
    } finally {
      setBusy(false);
    }
  }

  async function advanceToNextRound() {
    roomSessionRevision.current += 1;
    roomStateRevision.current += 1;
    setPendingBingoClaim(null);
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const data = await refreshRooms();
        refreshWallet().catch((reason) => console.warn('[Next-round balance refresh skipped]:', reason));
        const nextRoom = data.rooms.find((item) => item.status === 'WAITING'
          && Number(item.currentPlayers) < Number(item.maxPlayers));
        if (nextRoom && await enterRoom(nextRoom, { keepCurrentView: true })) return;
        lastError = new Error('No waiting room is ready for cartela selection yet.');
      } catch (reason) {
        lastError = reason;
        console.warn('[Next room lookup failed]:', reason);
      }
      if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
    setError(lastError?.message || 'Could not enter the next round. Please try again.');
  }

  async function saveLanguage(value) {
    const previousLanguage = lang;
    setBusy(true);
    setLang(value);
    setUser((current) => current ? { ...current, language: value } : current);
    setProfile((current) => current
      ? { ...current, user: { ...current.user, language: value } }
      : current);
    try {
      await request('/api/language', { method: 'POST', body: { language: value } });
      setError('');
    } catch (reason) {
      setLang(previousLanguage);
      setUser((current) => current ? { ...current, language: previousLanguage } : current);
      setProfile((current) => current
        ? { ...current, user: { ...current.user, language: previousLanguage } }
        : current);
      setError(reason.message);
    } finally {
      setBusy(false);
    }

  }

  const gameNumbers = useMemo(() => parseNumberList(game?.calledNumbers), [game?.calledNumbers]);
  const calledSet = useMemo(() => new Set(gameNumbers), [gameNumbers]);
  return <div className={`app-shell ${view === 'cartelas' ? 'cartela-app-shell' : ''} ${view === 'game' ? 'game-app-shell' : ''} ${view === 'winner' ? 'winner-app-shell' : ''}`}>
    {!['cartelas', 'game', 'winner'].includes(view) && <header className="topbar">
      <div className="brand-mark">
        <span className="brand-icon" aria-hidden="true">👑</span>
        <span className="brand-copy"><b>SHISHO BINGO</b><small>{user?.firstName || (telegramChecked ? t.playerFallback : t.loading)}</small></span>
      </div>
      <button className="wallet-chip" onClick={() => go('wallet')} aria-label={t.balance}>
        <span aria-hidden="true">💰</span> {wallet === null ? '—' : money(wallet)} <small>{t.currency}</small>
      </button>
    </header>}

    <main className="content">
      {view === 'play' && <PlayScreen t={t} rooms={rooms} myRoomId={myRoomId} roomsLoading={roomsLoading} onJoin={enterRoom} busy={busy} onRefresh={() => refreshRooms().catch((reason) => setError(reason.message))} />}
      {view === 'cartelas' && room && <CartelaScreen key={room.id} room={room} t={t} busy={busy} loading={!roomReady} wallet={wallet} onToggle={toggleCard} onBack={returnToLobby} onLeave={leaveRoom} />}
      {view === 'waiting' && room && <WaitingRoomScreen room={room} t={t} busy={busy} onManage={() => setView('cartelas')} onBack={returnToLobby} onLeave={leaveRoom} onRefresh={() => loadRoom(room.id)} />}
      {view === 'game' && room && <ErrorBoundary title="Game screen error"><GameScreen room={room} game={game} t={t} calledSet={calledSet} audioRef={callAudioRef} busy={busy} onLeave={leaveRoom} onRefresh={() => loadRoom(room.id)} onBingo={submitBingoClaim} /></ErrorBoundary>}
      {view === 'winner' && <WinnerScreen
        game={game}
        room={room}
        t={t}
        claimPending={Boolean(pendingBingoClaim)}
        pendingWinner={pendingBingoClaim}
        onNextRound={advanceToNextRound}
      />}
      {view === 'ranks' && <RanksScreen ranks={ranks} t={t} userId={user?.id} />}
      {view === 'history' && <HistoryScreen history={history} t={t} />}
      {view === 'profile' && <ProfileScreen profile={profile} user={user} wallet={wallet} t={t} onLanguage={saveLanguage} busy={busy} referral={referral} appInfo={appInfo} onRanks={() => go('ranks')} onRefresh={() => refreshWallet().catch((reason) => setError(reason.message))} />}
      {view === 'wallet' && <WalletScreen wallet={wallet} t={t} onRefresh={() => Promise.all([refreshWallet(), request('/api/history')]).catch((reason) => setError(reason.message))} onError={setError} />}
    </main>

    {!['cartelas', 'waiting', 'game', 'winner'].includes(view) && <nav className="bottom-nav">
      {[
        ['play', '🎮', t.play], ['ranks', '🏆', t.ranks], ['history', '📜', t.history], ['profile', '👤', t.profile],
      ].map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => go(id)}>
        <span>{icon}</span>{label}
      </button>)}
    </nav>}
    <style>{styles}</style>
  </div>;
}

function PlayScreen({ t, rooms, myRoomId, roomsLoading, onJoin, busy, onRefresh }) {
  const activeRoom = rooms.find((room) => String(room.id) === String(myRoomId))
    || rooms.find((room) => room.status === 'WAITING')
    || rooms.find((room) => ['PLAYING', 'VERIFYING'].includes(room.status));
  return <div className="play-screen">
    <section className="hero">
      <div className="hero-crown" aria-hidden="true">👑</div>
      <h1>SHISHO <b>BINGO</b></h1>
      <p>{t.welcome}</p>
      <div className="features">
        <span>🏆 {t.realtime}</span><span>🎟️ {t.multipleRooms}</span><span>💰 {t.instantRewards}</span>
      </div>
    </section>
    <section className="section-heading"><h2 className="eyebrow">{t.rooms}</h2></section>
    {roomsLoading && rooms.length === 0
      ? <div className="empty panel" role="status"><span className="empty-icon">🎱</span><strong>{t.loading}</strong></div>
      : !activeRoom
      ? <div className="empty panel"><span className="empty-icon">🎱</span><strong>{t.roomEmpty}</strong><p>{t.noRoomsHelp}</p><button className="outline-button" onClick={onRefresh}>↻ {t.retry}</button></div>
      : <div className="room-list">{[activeRoom].map((room) => {
        const status = ['PLAYING', 'VERIFYING'].includes(room.status)
          ? 'PLAYING'
          : Number(room.selectedCartelas || 0) > 0 ? 'SELECTING' : 'WAITING';
        return <article className="room-card panel stake-entry-card" key={room.id}>
          <div className="room-title stake-header-row">
            <span className="room-emblem stake-icon-badge" aria-hidden="true">💰</span>
            <div className="room-description stake-info-text">
              <h3>{t.stakeTitle} <span>{money(room.stake).replace(/\.00$/, '')} {t.currency}</span></h3>
              <small>{t.stakePitch}</small>
            </div>
            <button className="join-button btn-enter-game" disabled={busy || (room.status === 'WAITING' && room.currentPlayers >= room.maxPlayers)} onClick={() => onJoin(room)}>
              <span aria-hidden="true">▶</span> {busy ? t.loading : t.enterGame}
            </button>
          </div>
          <div className="room-stats stake-metrics-row">
            <div className="metric-box"><b className="metric-value">💰 {money(room.stake)}</b><small className="metric-label">{t.stakeAmount}</small></div>
            <div className="metric-box"><b className="metric-value">👥 {room.currentPlayers}/{room.maxPlayers}</b><small className="metric-label">{t.playersLabel}</small></div>
            <div className="metric-box"><b className={`metric-value room-status-${status.toLowerCase()}`}>{status === 'PLAYING' ? '🎱' : '⌛'} {t[`roomStatus${status[0]}${status.slice(1).toLowerCase()}`]}</b><small className="metric-label">{t.statusLabel}</small></div>
          </div>
          <section className="play-smart play-smart-pill">
            <div><h2>🎁 {t.playSmart}</h2><p>{t.playSmartHint.replace('{amount}', money(room.stake).replace(/\.00$/, ''))}</p></div>
            <span aria-hidden="true">🎟️</span>
          </section>
        </article>;
      })}</div>}
    <section className="how-to">
      <h2 className="eyebrow">{t.howToPlay}</h2>
      <div className="how-to-card panel">
        <div><b>1</b><span>{t.pickRoom}</span></div>
        <div><b>2</b><span>{t.chooseCards}</span></div>
        <div><b>3</b><span>{t.autoMarkWin}</span></div>
      </div>
    </section>
  </div>;
}

function CartelaScreen({ room, t, busy, loading, wallet, onToggle, onBack, onLeave }) {
  const [clockNow, setClockNow] = useState(Date.now());
  const [overrides, setOverrides] = useState({});
  const [pending, setPending] = useState({});
  const [balanceBase, setBalanceBase] = useState(wallet);
  const [potBase, setPotBase] = useState(room.pot ?? room.prizePool);
  const [notice, setNotice] = useState('');
  const mutationId = useRef(0);
  const noticeTimer = useRef(null);
  const waiting = room.status === 'WAITING';
  const countdown = room.countdown || {};
  const serverNow = clockNow + Number(countdown.clientOffset || 0);
  const countdownDeadline = Number(countdown.deadline);
  const secondsLeft = Number.isFinite(countdownDeadline)
    ? Math.max(0, Math.ceil((countdownDeadline - serverNow) / 1000))
    : 30;
  const cards = (room.cartelas || []).map((card) => ({
    ...card,
    state: overrides[card.number]?.state || card.state,
  }));
  const displayedCards = loading
    ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1, state: 'AVAILABLE' }))
    : cards;
  const mine = cards.filter((card) => card.state === 'MINE');
  const availableCartelas = cards.filter((card) => card.state === 'AVAILABLE').length;
  const pendingValues = Object.values(pending);
  const pendingBalanceDelta = pendingValues.reduce((sum, item) => sum + item.balanceDelta, 0n);
  const pendingPotDelta = pendingValues.reduce((sum, item) => sum + item.potDelta, 0n);
  const displayBalance = balanceBase === null || balanceBase === undefined
    ? null
    : minorUnitsToMoney(multiplyMoney(balanceBase, 1) + pendingBalanceDelta);
  const displayPot = minorUnitsToMoney(multiplyMoney(potBase || '0', 1) + pendingPotDelta);
  const stakeMinorUnits = multiplyMoney(room.stake, 1);
  const stakeLabel = money(room.stake).replace(/\.00$/, '');
  const timerLabel = waiting
    ? secondsLeft < 60 ? `${secondsLeft}s` : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
    : room.status;

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    if (Object.keys(pending).length === 0) {
      setBalanceBase(wallet);
      setPotBase(room.pot ?? room.prizePool);
    }
  }, [wallet, room.pot, room.prizePool, pending]);

  useEffect(() => {
    setOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const [number, value] of Object.entries(current)) {
        if (!value.pendingId && room.cartelas?.find((card) => Number(card.number) === Number(number))?.state === value.state) {
          delete next[number];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [room.cartelas]);

  function showNotice(message) {
    window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2600);
  }

  async function chooseCartela(card) {
    if (!waiting) return;
    if (card.state === 'TAKEN' || overrides[card.number]?.pendingId) return;
    const action = card.state === 'MINE' ? 'deselect' : 'select';
    const selectedCount = cards.filter((item) => item.state === 'MINE').length;
    if (action === 'select' && selectedCount >= MAX_CARTELAS_PER_PLAYER) {
      showNotice(t.maximumCartelas);
      return;
    }
    if (action === 'select' && (displayBalance === null || multiplyMoney(displayBalance, 1) < stakeMinorUnits)) {
      showNotice(t.insufficientBalance);
      return;
    }

    const id = ++mutationId.current;
    const nextState = action === 'select' ? 'MINE' : 'AVAILABLE';
    const balanceDelta = action === 'select' ? -stakeMinorUnits : stakeMinorUnits;
    const potDelta = (action === 'select' ? 1n : -1n) * (stakeMinorUnits * 80n / 100n);
    setOverrides((current) => ({ ...current, [card.number]: { state: nextState, pendingId: id } }));
    setPending((current) => ({ ...current, [id]: { balanceDelta, potDelta } }));
    setNotice('');
    try {
      telegramWebApp()?.HapticFeedback?.impactOccurred?.('light');
      const result = await onToggle(card, action);
      setBalanceBase(result.wallet.availableBalance);
      setPotBase(result.room.pot ?? result.room.prizePool);
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOverrides((current) => current[card.number]?.pendingId === id
        ? { ...current, [card.number]: { state: nextState, pendingId: null } }
        : current);
    } catch (error) {
      telegramWebApp()?.HapticFeedback?.notificationOccurred?.('error');
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOverrides((current) => {
        if (current[card.number]?.pendingId !== id) return current;
        if (action === 'select' && (error.code === 'CARTELA_TAKEN' || /already been taken/i.test(error.message))) {
          return { ...current, [card.number]: { state: 'TAKEN', pendingId: null } };
        }
        const next = { ...current };
        delete next[card.number];
        return next;
      });
      console.warn('[Cartela toggle failed, optimistic selection rolled back]:', error);
    }
  }

  return <div className="cartela-screen">
    <header className="cartela-screen-header">
      <button className="cartela-back" disabled={busy} onClick={onBack}>← {t.back}</button>
      <div className="cartela-brand-title"><strong>SHISHO BINGO</strong><small>ሺሾ ቢንጎ</small></div>
      <span aria-hidden="true" />
    </header>
    <section className="cartela-hud" aria-label={t.roomMetrics}>
      <div className="cartela-hud-card"><small>{t.balance.toUpperCase()}</small><b>{displayBalance === null ? t.unavailable : displayBalance}</b></div>
      <div className="cartela-hud-card"><small>{t.stakeLabel}</small><b>{stakeLabel}</b></div>
      <div className="cartela-hud-card pot"><small>{t.pot}</small><b>{displayPot.replace(/\.00$/, '')}</b></div>
      <div className="cartela-hud-card starts-in"><small>{t.startingIn}</small><b>{timerLabel}</b></div>
    </section>
    {!waiting && <p className="cartela-closed-note" role="status">{t.cartelaClosed}</p>}
    {loading
      ? <div className="cartela-grid-8col" aria-label={t.cartelaSelection} aria-busy="true">
        {displayedCards.map((card) => <button
          key={`${room.id}-${card.number}`}
          className="cartela-btn loading"
          disabled
          aria-label={`${t.cartela} ${card.number}: ${t.loading}`}
        >{card.number}</button>)}
      </div>
      : cards.length !== 100
      ? <div className="cartela-load-error" role="alert">{t.cartelaLoadFailed.replace('{count}', cards.length)}</div>
      : <div className="cartela-grid-8col" aria-label={t.cartelaSelection}>
        {cards.map((card) => <button
          key={`${room.id}-${card.number}`}
          className={`cartela-btn ${card.state === 'MINE' ? 'mine' : card.state === 'TAKEN' ? 'taken' : 'available'}`}
          disabled={card.state === 'TAKEN' || !waiting || Boolean(overrides[card.number]?.pendingId)}
          aria-label={`${t.cartela} ${card.number}: ${card.state === 'MINE' ? t.selected : card.state === 'TAKEN' ? t.taken : t.available}`}
          onClick={() => chooseCartela(card)}
        >{card.number}</button>)}
      </div>}
    <section className="cartela-previews" aria-label={t.selectedCartelas}>
      {mine.length
        ? mine.map((card) => <article className="cartela-preview-card" key={card.number}>
          <h2>{t.cartelaNumberTitle.replace('{number}', card.number)}</h2>
          <div className="cartela-preview-board">
            {['B', 'I', 'N', 'G', 'O'].map((letter, column) => <div className="cartela-preview-column" key={letter}>
              <b>{letter}</b>
              {[0, 1, 2, 3, 4].map((row) => {
                const value = card.numbers?.[row * 5 + column];
                return <span className={value === 'FREE' ? 'free' : ''} key={`${row}-${column}`}>{value === 'FREE' ? t.free : value ?? '—'}</span>;
              })}
            </div>)}
          </div>
        </article>)
        : <p className="cartela-preview-placeholder">{t.selectPreview}</p>}
    </section>
    <aside className="cartela-bottom-hud" aria-label={t.roomSummary}>
      <div className="cartela-bottom-counts">
        <span>☑ {mine.length}/{MAX_CARTELAS_PER_PLAYER}</span>
        <span>▦ {availableCartelas}/100</span>
        <span>👤 {room.currentPlayers}</span>
      </div>
      <button className="cartela-leave-button" disabled={busy || !waiting} onClick={onLeave}>← {t.leave.toUpperCase()}</button>
    </aside>
    {notice && <div className="cartela-toast" role="status">{notice}</div>}
  </div>;
}

function WaitingRoomScreen({ room, t, busy, onManage, onBack, onLeave, onRefresh }) {
  const selected = room.cartelas.filter((card) => card.state === 'MINE');
  return <>
    <button className="text-button" onClick={onBack}>← {t.backToRooms}</button>
    <section className="waiting-room panel">
      <div className="waiting-crown">👑</div>
      <div className="eyebrow">{t.roomNumber.replace('{number}', room.roomNumber || room.id)}</div>
      <h1>{t.roomStatus}</h1>
      <span className="status status-waiting">{t[['PLAYING', 'VERIFYING'].includes(room.status) ? 'playing' : 'waiting']}</span>
      <p>{t.waitingPlayers.replace('{count}', room.minPlayers)}</p>
      <div className="room-info-grid">
        <div><small>{t.playersLabel}</small><b>{room.currentPlayers}/{room.maxPlayers}</b></div>
        <div><small>{t.yourCartelas}</small><b>{selected.map((card) => `#${card.number}`).join(', ') || '—'}</b></div>
        <div><small>{t.prizePool}</small><b>{money(room.prizePool)} {t.currency}</b></div>
      </div>
      <button className="primary-button" disabled={busy} onClick={onRefresh}>↻ {t.refreshRoom}</button>
      <button className="outline-button" disabled={busy} onClick={onManage}>{t.manageCartelas}</button>
      <button className="danger-button" disabled={busy} onClick={onLeave}>{t.leaveRefund}</button>
    </section>
  </>;
}

function GameScreen({ room, game, t, calledSet, audioRef, busy, onLeave, onRefresh, onBingo }) {
  const [autoMark, setAutoMark] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const claimInFlight = useRef(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return window.localStorage.getItem('shisho_sound') !== 'false'; }
    catch { return true; }
  });
  const [manualMarks, setManualMarks] = useState({});
  const [invalidCells, setInvalidCells] = useState({});
  const [claimPaused, setClaimPaused] = useState(false);
  const myCards = useMemo(
    () => (Array.isArray(room?.cartelas) ? room.cartelas : []).filter((card) => card && card.state === 'MINE'),
    [room?.cartelas],
  );
  const activeAudioRef = audioRef;
  const frozenNumbersRef = useRef(null);
  const calledNumbers = useMemo(() => parseNumberList(game?.calledNumbers), [game?.calledNumbers]);
  const callsAreFrozen = room?.status !== 'PLAYING' || game?.status === 'FINISHED' || claimPaused || isClaiming;
  const displayedNumbers = useMemo(() => {
    if (callsAreFrozen) return frozenNumbersRef.current || calledNumbers;
    return calledNumbers;
  }, [callsAreFrozen, calledNumbers]);
  const displayedCalledSet = useMemo(() => new Set(displayedNumbers.map(Number)), [displayedNumbers]);
  const recent = displayedNumbers.slice(-2).reverse();
  const currentNumber = displayedNumbers.at(-1) ?? null;
  const previousNumber = recent[1] ?? null;
  const markedNumbersFor = (card) => autoMark
    ? displayedCalledSet
    : new Set(manualMarks[card.number] || []);
  const winningCardNumber = useMemo(() => {
    for (const card of myCards) {
      if (winningPatternForCard(card.numbers, displayedCalledSet)) return Number(card.number);
    }
    return null;
  }, [myCards, displayedCalledSet]);
  const isBingoReady = winningCardNumber !== null;
  const claimableCards = useMemo(
    () => myCards.filter((card) => winningPatternForCard(card.numbers, displayedCalledSet)),
    [myCards, displayedCalledSet],
  );
  const isSpectator = !myCards.length;
  const previousCall = useRef(null);
  useEffect(() => {
    if (!soundEnabled || currentNumber === null || callsAreFrozen || previousCall.current === currentNumber) {
      previousCall.current = currentNumber;
      return undefined;
    }
    let active = true;
    let speechFallbackStarted = false;
    const speakFallback = () => {
      if (!active || !soundEnabled || speechFallbackStarted) return;
      speechFallbackStarted = true;
      try {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
          console.warn('Speech synthesis is unavailable on this device.');
          return;
        }
        const voices = window.speechSynthesis.getVoices();
        if (!voices.some((voice) => voice.lang.toLowerCase().startsWith('am'))) {
          console.warn('No Amharic speech voice is available; using the device default voice.');
        }
        const utterance = new window.SpeechSynthesisUtterance(amharicCallText(currentNumber));
        utterance.lang = 'am-ET';
        utterance.rate = 0.9;
        utterance.onerror = (event) => console.warn('[Amharic speech playback failed]:', event.error);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        console.warn('Amharic bingo call could not be played:', error.message);
      }
    };
    try {
      const audio = activeAudioRef.current;
      if (!audio) return undefined;
      audio.onerror = () => speakFallback();
      playAmharicBall(currentNumber, soundEnabled, () => speakFallback());
    } catch (error) {
      console.warn(`[Amharic audio clip unavailable for ${currentNumber}]:`, error.message);
      speakFallback();
    }
    previousCall.current = currentNumber;
    return () => {
      active = false;
      const audio = activeAudioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      window.speechSynthesis?.cancel();
    };
  }, [currentNumber, soundEnabled, callsAreFrozen]);
  useEffect(() => {
    try { window.localStorage.setItem('shisho_sound', String(soundEnabled)); }
    catch (error) { console.warn('Sound preference could not be saved:', error.message); }
    if (!soundEnabled) {
      activeAudioRef.current?.pause();
      if (activeAudioRef.current) activeAudioRef.current.currentTime = 0;
      window.speechSynthesis?.cancel();
    }
  }, [soundEnabled]);
  const toggleAutoMark = () => {
    if (autoMark) {
      setManualMarks(Object.fromEntries(myCards.map((card) => [
        card.number,
        (card.numbers || []).filter((value) => value !== 'FREE' && displayedCalledSet.has(Number(value))).map(Number),
      ])));
      setAutoMark(false);
      return;
    }
    setAutoMark(true);
  };
  const handleManualMark = (card, value, cellIndex) => {
    if (value === 'FREE') return;
    const number = Number(value);
    const key = `${card.number}:${cellIndex}`;
    if (!displayedCalledSet.has(number)) {
      telegramWebApp()?.HapticFeedback?.notificationOccurred?.('error');
      setInvalidCells((cells) => ({ ...cells, [key]: true }));
      window.setTimeout(() => setInvalidCells((cells) => {
        const next = { ...cells };
        delete next[key];
        return next;
      }), 320);
      return;
    }
    telegramWebApp()?.HapticFeedback?.impactOccurred?.('light');
    setManualMarks((marks) => {
      const selected = new Set(marks[card.number] || []);
      if (selected.has(number)) selected.delete(number);
      else selected.add(number);
      return { ...marks, [card.number]: [...selected] };
    });
  };
  const handleBingoClaim = async () => {
    if (!isBingoReady || !claimableCards.length || isClaiming || claimInFlight.current) return;
    claimInFlight.current = true;
    setIsClaiming(true);
    frozenNumbersRef.current = displayedNumbers;
    setClaimPaused(true);
    telegramWebApp()?.HapticFeedback?.notificationOccurred?.('success');
    try {
      await onBingo(claimableCards.map((card) => card.number), winningCardNumber, displayedNumbers);
    } catch (error) {
      console.error('[Bingo claim error]:', error);
      frozenNumbersRef.current = null;
      setClaimPaused(false);
      const message = error.message || 'Error claiming Bingo.';
      const telegram = telegramWebApp();
      if (telegram?.showAlert) telegram.showAlert(message);
      else window.alert(message);
    } finally {
      claimInFlight.current = false;
      setIsClaiming(false);
    }
  };
  return <section className="live-game">
    <header className="live-game-header">
      <button className="live-back" onClick={onLeave}>← {t.back}</button>
      <div className="live-brand"><strong>SHISHO BINGO</strong><small>ሺሾ ቢንጎ · {t.roomNumber.replace('{number}', room.roomNumber || room.id)}</small></div>
      <span aria-hidden="true" />
    </header>
    <section className="live-game-hud">
      <div><small>{t.round}</small><b>#{room.roomNumber || room.id}</b></div>
      <div className="pot"><small>{t.pot}</small><b>{money(room.pot ?? room.prizePool)}</b></div>
      <div><small>{t.playersLabel}</small><b>{room.currentPlayers}</b></div>
      <div><small>{t.stakeLabel}</small><b>{money(room.stake)}</b></div>
      <div className="called"><small>{t.called}</small><b>{displayedNumbers.length}/75</b></div>
    </section>
    <div className="live-play-arena">
      <section className="live-board-panel master-panel">
        <div className="live-master-grid">
          {['B', 'I', 'N', 'G', 'O'].map((letter) => <b className={`master-col-header ${letter.toLowerCase()}`} key={letter}>{letter}</b>)}
          {Array.from({ length: 15 }, (_, row) => ['B', 'I', 'N', 'G', 'O'].map((_, column) => {
            const number = [1, 16, 31, 46, 61][column] + row;
            return <span className={`master-cell ${displayedCalledSet.has(number) ? 'called' : ''} ${currentNumber === number ? 'current' : ''}`} key={number}>{number}</span>;
          }))}
        </div>
      </section>
      <section className="live-right-column">
        <div className="live-call-strip" aria-live="polite">
          <div className="live-current-call"><small>{t.currentBall}</small>
            <strong key={currentNumber ?? 'waiting'}>{currentNumber === null ? '—' : bingoLabel(currentNumber)}</strong>
          </div>
          <div className="live-recent-calls"><small>{t.recent}</small>
            <span className="recent-ball">{previousNumber === null ? '—' : bingoLabel(previousNumber)}</span>
          </div>
        </div>
        <div className="live-controls">
          <button className={`auto-toggle ${autoMark ? 'enabled' : ''}`} aria-pressed={autoMark} onClick={toggleAutoMark}>
            <span>{t.auto}</span><i><b /></i>
          </button>
          <button className={`sound-toggle ${soundEnabled ? 'enabled' : ''}`} aria-pressed={soundEnabled} onClick={() => {
            if (soundEnabled) {
                  activeAudioRef.current?.pause();
                  if (activeAudioRef.current) activeAudioRef.current.currentTime = 0;
              window.speechSynthesis?.cancel();
            }
            setSoundEnabled((value) => !value);
          }}>
            {soundEnabled ? '🔊' : '🔇'} {t.sound}
          </button>
        </div>
        {isSpectator
          ? <div className="live-spectator-card"><span>👁</span><strong>{t.watchingLive}</strong><small>{t.callsSynced}</small></div>
          : <div className="cartelas-stack">
            {myCards.map((card) => <article className="live-cartela-card" key={card.number}>
              <div className="mini-card-title"><span>#{card.number}</span><small>{card.progress || 0}% {t.marked}</small></div>
              <CardNumbers
                numbers={card.numbers}
                cardNumber={card.number}
                t={t}
                calledSet={markedNumbersFor(card)}
                interactive={!autoMark}
                invalidCells={invalidCells}
                onManualMark={(value, index) => handleManualMark(card, value, index)}
              />
            </article>)}
          </div>}
        {!isSpectator && <button
          className={`btn-bingo btn-bingo-action ${isBingoReady ? 'active-yellow' : ''}`}
          disabled={busy || isClaiming || room.status === 'VERIFYING' || !isBingoReady}
          onClick={handleBingoClaim}
        >{isClaiming || room.status === 'VERIFYING' ? t.claimingBingo : t.bingo}</button>}
      </section>
    </div>
    <footer className="live-game-footer">
      <button className="footer-leave" onClick={onLeave}>🚪 {t.leave}</button>
      <button className="footer-refresh" onClick={onRefresh}>🔄 {t.refresh}</button>
    </footer>
  </section>;
}

function CardNumbers({ numbers, cardNumber, t, calledSet, interactive = false, invalidCells = {}, onManualMark }) {
  const values = Array.isArray(numbers) && numbers.length === 25 ? numbers : Array(25).fill(null);
  const markedPattern = winningPatternForCard(values, calledSet);
  return <div className="player-grid">
    {['B', 'I', 'N', 'G', 'O'].map((letter) => <b key={`h-${letter}`}>{letter}</b>)}
    {values.map((value, index) => <button
      type="button"
      key={index}
      className={`cartela-cell ${value === 'FREE' ? 'free' : ''} ${value === 'FREE' || calledSet.has(Number(value)) ? 'marked' : ''} ${markedPattern?.has(index) ? 'win-cell' : ''} ${invalidCells?.[`${cardNumber}:${index}`] ? 'invalid-click' : ''}`}
      disabled={!interactive || value == null || value === 'FREE'}
      aria-label={value === 'FREE' ? t.freeSpaceLabel : `${t.cartelaCellNumber.replace('{number}', value)}${calledSet.has(Number(value)) ? `, ${t.markedCell}` : ''}`}
      onClick={() => onManualMark?.(value, index)}
    >{value === 'FREE' ? '★' : value ?? '—'}</button>)}
  </div>;
}

function winningPatternForCard(numbers = [], calledSet = new Set()) {
  if (!Array.isArray(numbers) || numbers.length !== 25) return null;
  const marked = numbers.map((value) => value === 'FREE' || calledSet.has(Number(value)));
  for (let row = 0; row < 5; row += 1) {
    const indexes = Array.from({ length: 5 }, (_, column) => row * 5 + column);
    if (indexes.every((index) => marked[index])) return new Set(indexes);
  }
  for (let column = 0; column < 5; column += 1) {
    const indexes = Array.from({ length: 5 }, (_, row) => row * 5 + column);
    if (indexes.every((index) => marked[index])) return new Set(indexes);
  }
  const diagonal = [0, 6, 12, 18, 24];
  if (diagonal.every((index) => marked[index])) return new Set(diagonal);
  const reverseDiagonal = [4, 8, 12, 16, 20];
  if (reverseDiagonal.every((index) => marked[index])) return new Set(reverseDiagonal);
  const corners = [0, 4, 20, 24];
  if (corners.every((index) => marked[index])) return new Set(corners);
  return null;
}

function bingoLabel(number) {
  const n = Number(number);
  return `${n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O'}-${n}`;
}

function WinnerScreen({ game, room, t, claimPending = false, pendingWinner, onNextRound }) {
  const [seconds, setSeconds] = useState(7);
  const nextRoundRef = useRef(onNextRound);
  const advanceStarted = useRef(false);
  const fallbackDeadline = useRef(null);
  const fallbackRoomId = useRef(null);
  const confirmedWinners = game?.winners || [];
  const previewWinner = claimPending && pendingWinner ? {
    userId: 'pending-claim',
    displayName: pendingWinner.displayName,
    username: pendingWinner.username,
    cartelaNumber: pendingWinner.cartelaNumber,
  } : null;
  const winners = confirmedWinners.length ? confirmedWinners : previewWinner ? [previewWinner] : [];
  const winner = winners[0];
  const winnerPlayerCount = new Set(winners.map((item) => item.userId)).size;
  const winningCartelaNumber = winner?.cartelaNumber;
  const winningCard = winningCartelaNumber != null
    ? room?.cartelas?.find((card) => Number(card.number) === Number(winningCartelaNumber))
    : null;
  const winnerCalledNumbers = parseNumberList(game?.calledNumbers);
  const called = new Set(winnerCalledNumbers);
  const highlighted = winningCard
    ? winningPatternForCard(winningCard.numbers, called)
    : null;
  const finishedAt = Number(room?.finishedAt ?? game?.finishedAt);
  const clientClockOffset = Number(game?.clientClockOffset) || 0;
  const isFinished = game?.status === 'FINISHED' || room?.status === 'FINISHED';
  if (fallbackRoomId.current !== String(room?.id)) {
    fallbackRoomId.current = String(room?.id);
    fallbackDeadline.current = null;
  }
  if ((claimPending || isFinished) && (!Number.isFinite(finishedAt) || finishedAt <= 0)
    && fallbackDeadline.current === null) {
    fallbackDeadline.current = Number(pendingWinner?.countdownDeadline) || Date.now() + 7000;
  }
  const countdownDeadline = Number.isFinite(finishedAt) && finishedAt > 0
    ? finishedAt + 7000 - clientClockOffset
    : Number(room?.claimDeadline) > 0
      ? Number(room.claimDeadline) - clientClockOffset
      : fallbackDeadline.current;
  useEffect(() => { nextRoundRef.current = onNextRound; }, [onNextRound]);
  useEffect(() => {
    if (countdownDeadline === null) return undefined;
    const update = () => {
      const remainingMs = Math.max(0, countdownDeadline - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setSeconds(remainingSeconds);
      if (remainingMs === 0 && !claimPending
        && (game?.status === 'FINISHED' || room?.status === 'FINISHED'
          || (room?.status === 'VERIFYING' && winners.length > 0))
        && !advanceStarted.current) {
        advanceStarted.current = true;
        nextRoundRef.current();
      }
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [claimPending, countdownDeadline, game?.status, room?.status, winners.length]);
  return <section className={`winner-celebration ${claimPending ? 'optimistic-winner' : ''} ${winners.length ? 'has-winner' : ''}`}>
    <div className="winner-glow" aria-hidden="true" />
    <div className="winner-trophy">{winners.length ? '👑' : '🎱'}</div>
    <div className="eyebrow">SHISHO BINGO · {t.roomNumber.replace('{number}', room?.roomNumber || room?.id || '—')}</div>
    <h1>{winners.length ? t.winnerHeadline : t.gameOver}</h1>
    <p className="winner-subtitle">{winnerPlayerCount > 1 ? t.multiWinners.replace('{count}', winnerPlayerCount) : winnerPlayerCount ? t.singleWinner : t.noWinner}</p>
    {winners.length > 0 && <div className="winner-pot">{t.winnerPot.replace('{amount}', money(winner?.prize ?? room?.pot ?? room?.prizePool))}</div>}
    {winners.length > 0 && <div className="winner-list">
      {winners.map((item) => <div key={`${item.userId}-${item.cartelaNumber}`}>
        <b>👑 {item.username ? `@${item.username}` : item.displayName}</b>
        <span>#{item.cartelaNumber}</span>
      </div>)}
    </div>}
    {winningCard && <section className="winner-card-section">
      <div className="winner-card-title"><span>{t.winningCartela.replace('{number}', winningCard.number)}</span><small>{game?.callIndex || winnerCalledNumbers.length} {t.calls}</small></div>
      <div className="player-grid winner-player-grid">
        {['B', 'I', 'N', 'G', 'O'].map((letter) => <b key={`winner-${letter}`}>{letter}</b>)}
        {winningCard.numbers.map((value, index) => <span key={index}
          className={`${value === 'FREE' ? 'free marked' : ''} ${value !== 'FREE' && called.has(Number(value)) ? 'marked' : ''} ${highlighted?.has(index) ? 'winning-cell' : ''}`}>
          {value === 'FREE' ? '★' : value}
        </span>)}
      </div>
    </section>}
    {!claimPending && winner && <div className="winner-verified">{t.verified}</div>}
    {countdownDeadline !== null && <p className="winner-countdown">{t.nextRound.replace('{seconds}', seconds)}</p>}
  </section>;
}

function RanksScreen({ ranks, t, userId }) {
  return <><div className="eyebrow">SHISHO BINGO</div><h1 className="page-title">🏆 {t.ranks}</h1>
    {ranks.length ? <div className="panel rank-list">{ranks.map((rank, i) => <div className="rank-row" key={rank.userId || i}>
      <span className="rank-position">{rank.rank || i + 1}</span><strong>{rank.displayName}{rank.userId === userId ? ` ${t.you}` : ''}</strong><span>{rank.gamesWon} {t.wins}</span><b>{money(rank.winnings)} {t.currency}</b>
    </div>)}</div> : <div className="empty panel"><span className="empty-icon">👑</span><strong>{t.noRanks}</strong></div>}
  </>;
}

function HistoryScreen({ history, t }) {
  return <><div className="eyebrow">SHISHO BINGO</div><h1 className="page-title">📜 {t.history}</h1>
    {history.length ? <div className="history-list">{history.map((item, index) => <article className="panel history-item" key={item.id || index}>
      <div className="row"><strong>{item.roomId ? t.historyRoom.replace('{id}', item.roomId) : item.type}</strong><span className="status">{item.result || item.status || item.type}</span></div>
      <p>{item.cartelas ? `${t.cartelasLabel} ${item.cartelas.join(', ')} · ${t.stakeLabelInHistory} ${money(item.stake)} ${t.currency}${item.pattern ? ` · ${t.patternLabel} ${item.pattern}` : ''}` : item.description}</p>
      <div className="row muted"><span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</span><b>{item.prize ? `${money(item.prize)} ${t.currency}` : item.amount ? `${money(item.amount)} ${t.currency}` : ''}</b></div>
    </article>)}</div> : <div className="empty panel"><span className="empty-icon">📜</span><strong>{t.noHistory}</strong></div>}
  </>;
}

function ProfileScreen({ profile, user, wallet, t, onLanguage, busy, referral, appInfo, onRanks, onRefresh }) {
  const [roomMessage, setRoomMessage] = useState('');
  const info = profile?.user || user;
  async function shareInvite() {
    if (!referral?.referralUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: 'SHISHO BINGO', url: referral.referralUrl });
      else {
        await navigator.clipboard.writeText(referral.referralUrl);
        setRoomMessage(t.inviteCopied);
      }
    } catch (error) {
      if (error.name !== 'AbortError') setRoomMessage(t.shareFailed);
    }
  }
  return <><div className="eyebrow">{t.playerProfile}</div><h1 className="page-title">👤 {t.profile}</h1>
    <section className="profile-card panel"><div className="avatar">{(info?.firstName || 'S').slice(0, 1).toUpperCase()}</div>
      <h2>{[info?.firstName, info?.lastName].filter(Boolean).join(' ') || t.loading}</h2><p className="muted">{info?.username ? `@${info.username} · ` : ''}{t.playerId} {info?.id || '—'}</p>
      {info?.phoneNumber && <p className="muted">📱 {info.phoneNumber}</p>}
      <div className="profile-stats">
        <Stat label={t.balance} value={wallet === null ? t.unavailable : `${money(wallet)} ${t.currency}`} />
        <Stat label={t.gamesWon} value={profile?.games?.won ?? '—'} />
        <Stat label={t.winnings} value={profile?.games?.winnings ? `${money(profile.games.winnings)} ${t.currency}` : '—'} />
        <Stat label={t.winRate} value={`${profile?.games?.winRate ?? '—'}%`} />
        <Stat label={t.referrals} value={profile?.referrals?.successful ?? '—'} />
      </div>
      <button disabled={busy} className="outline-button" onClick={onRefresh}>↻ {t.refresh}</button>
    </section>
    <section className="panel settings"><h2>{t.settingsTitle}</h2><div className="row"><span>{t.language}</span>
      <div className="language-control"><button className={info?.language === 'en' ? 'selected' : ''} onClick={() => onLanguage('en')}>🇬🇧 {t.languageEnglish}</button><button className={info?.language === 'am' ? 'selected' : ''} onClick={() => onLanguage('am')}>🇪🇹 {t.languageAmharic}</button></div>
    </div><div className="row"><span>{t.rulesTitle}</span><span className="muted">{t.rules}</span></div>
      <button className="outline-button" onClick={onRanks}>🏆 {t.ranks}</button>
    </section>
    <section className="panel settings"><h2>{t.shareAndInvite}</h2>
      <p className="muted">{referral?.referralUrl || t.loading}</p>
      <div className="row">
        <button className="outline-button" onClick={shareInvite} disabled={!referral?.referralUrl}>{t.copy} / {t.shareAction}</button>
        <button className="outline-button" onClick={() => appInfo?.supportUrl && telegramWebApp()?.openTelegramLink(appInfo.supportUrl)} disabled={!appInfo?.supportUrl}>{t.support}</button>
      </div>
      <p className="muted">{t.successfulReferrals} {referral?.successful ?? '—'}</p>
      {roomMessage && <p className="muted" role="status">{roomMessage}</p>}
    </section>
  </>;
}

function Stat({ label, value }) {
  return <div className="stat"><small>{label}</small><b>{value}</b></div>;
}

function WalletScreen({ wallet, t, onRefresh, onError }) {
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [withdrawMethod, setWithdrawMethod] = useState('TELEBIRR');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [withdrawStatus, setWithdrawStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    api('/api/deposit-options', { initData: telegramWebApp()?.initData }).then((data) => {
      setMethods(data.methods);
      setMethod(data.methods[0]?.method || '');
    }).catch((error) => setStatus(error.message));
  }, []);
  const current = methods.find((item) => item.method === method);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      const data = await api('/api/deposits', {
        initData: telegramWebApp()?.initData,
        method: 'POST',
        body: { method, amount, providerReference: reference },
      });
      setStatus(t.depositSubmitted.replace('{id}', data.request.id));
      setAmount('');
      setReference('');
    } catch (error) {
      setStatus(error.message);
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function submitWithdrawal(event) {
    event.preventDefault();
    setBusy(true);
    setWithdrawStatus('');
    try {
      const data = await api('/api/withdrawals', {
        initData: telegramWebApp()?.initData,
        method: 'POST',
        body: {
          amount: withdrawAmount,
          method: withdrawMethod,
          payoutDetails,
          destinationName,
          idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
        },
      });
      setWithdrawStatus(t.withdrawalSubmitted.replace('{id}', data.request.id));
      setWithdrawAmount('');
      setPayoutDetails('');
      setDestinationName('');
      await onRefresh();
    } catch (error) {
      setWithdrawStatus(error.message);
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="eyebrow">{t.sharedWallet}</div><h1 className="page-title">💰 {t.balance}</h1>
    <section className="panel wallet-panel"><small>{t.availableBalance}</small><strong>{wallet === null ? t.unavailable : `${money(wallet)} ${t.currency}`}</strong><button className="outline-button" onClick={() => onRefresh().catch((error) => onError(error.message))}>↻ {t.refresh}</button></section>
    <section className="panel wallet-panel"><h2>{t.deposit}</h2>{methods.length ? <form onSubmit={submit}>
      <label>{t.paymentMethod}<select value={method} onChange={(event) => setMethod(event.target.value)}>{methods.map((item) => <option key={item.method} value={item.method}>{item.label}</option>)}</select></label>
      {current && <p className="payment-details">{current.label} · {current.accountName} · {current.account}</p>}
      <label>{t.amountBirr}<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>{t.transactionReference}<input required maxLength="128" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <button className="primary-button" disabled={busy}>{busy ? t.loading : t.submitApproval}</button>
      {status && <p className="muted">{status}</p>}
    </form> : <p className="muted">{status || t.depositOptionsMissing}</p>}</section>
    <section className="panel wallet-panel"><h2>{t.withdraw}</h2>
      <p className="muted">{t.minWithdrawal}</p>
      <form onSubmit={submitWithdrawal}>
        <label>{t.amountBirr}<input required inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} /></label>
        <label>{t.paymentMethod}<select value={withdrawMethod} onChange={(event) => setWithdrawMethod(event.target.value)}><option value="TELEBIRR">Telebirr</option><option value="CBE">CBE</option></select></label>
        <label>{t.accountDetails}<input required minLength="5" maxLength="191" value={payoutDetails} onChange={(event) => setPayoutDetails(event.target.value)} /></label>
        <label>{t.destinationName}<input required minLength="2" maxLength="255" value={destinationName} onChange={(event) => setDestinationName(event.target.value)} /></label>
        <button className="primary-button" disabled={busy}>{busy ? t.loading : t.withdraw}</button>
        {withdrawStatus && <p className="muted" role="status">{withdrawStatus}</p>}
      </form>
    </section>
  </>;
}

const styles = `
:root{color-scheme:dark;--bg:#08030f;--surface:#10071d;--card:#170b27;--panel:#211132;--gold:#ffc400;--gold-hi:#ffe36a;--purple:#8b5cf6;--text:#fff;--muted:#b9aec9;--line:#52391b;--red:#ef4444;--green:#22c55e}
*{box-sizing:border-box}html{background:var(--bg);scrollbar-gutter:stable}body{margin:0;background:radial-gradient(ellipse at 50% -18%,#29143f 0,transparent 50%),var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
button,input,select{font:inherit}button{color:inherit;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.app-shell{min-height:100vh;padding-bottom:calc(86px + env(safe-area-inset-bottom));max-width:760px;margin:auto}.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;background:#0b0614ed;backdrop-filter:blur(14px);border-bottom:1px solid #332348}.brand-mark{display:flex;align-items:center;gap:7px;font-weight:850;letter-spacing:.07em;font-size:14px;white-space:nowrap}.brand-mark b,.gold{color:var(--gold)}.crown{color:var(--gold);font-size:22px;text-shadow:0 0 12px #ffc40080}.player-chip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);margin-left:auto;max-width:120px}.wallet-chip{border:1px solid #82601f;border-radius:999px;background:#251b11;color:var(--gold-hi);padding:8px 11px;font-size:12px;font-weight:750;white-space:nowrap}
.content{padding:14px 15px 26px}.hero{position:relative;overflow:hidden;min-height:210px;padding:24px 20px 14px;border:1px solid #b88627;border-radius:23px;background:radial-gradient(ellipse at 70% 0,#40265e 0,transparent 54%),linear-gradient(145deg,#170b27,#0d0616 70%);box-shadow:0 0 25px #dba9161a}.hero-copy{position:relative;z-index:1}.eyebrow{color:var(--gold);font-size:10px;font-weight:850;letter-spacing:.17em}.hero h1{font-size:clamp(27px,8vw,42px);line-height:1;margin:12px 0 7px;letter-spacing:-.04em}.hero h1 b{color:var(--gold);text-shadow:0 0 18px #ffc40050}.hero p{margin:0;color:var(--muted);font-size:16px}.ball-ball{position:absolute;display:grid;place-items:center;width:49px;height:49px;border-radius:50%;background:linear-gradient(150deg,#fff,#f5c43c 42%,#a36c05);color:#291b04;font-weight:900;box-shadow:0 0 18px #ffc40060;transform:rotate(-12deg)}.ball-ball span{font-size:14px}.ball-one{right:56px;top:34px}.ball-two{right:20px;top:85px;background:linear-gradient(150deg,#eee,#a776ff 50%,#51249b);color:#fff}.features{display:flex;gap:8px;overflow:auto;margin-top:25px;padding-top:12px;border-top:1px solid #6e552e;color:#e7dcf0;font-size:10px}.features span{flex:1;min-width:90px;text-align:center}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:24px 0 12px}.section-heading h2,.section-heading h3{margin:3px 0;font-size:20px}.outline-button,.text-button{border:1px solid #725621;border-radius:11px;background:#191023;padding:9px 12px;color:var(--gold);font-weight:700}.text-button{border:0;background:transparent;padding:5px 0}.panel{border:1px solid #65491c;border-radius:18px;background:linear-gradient(145deg,#1b1028,#110a1c);box-shadow:0 9px 28px #0003}.room-list{display:grid;gap:12px}.room-card{padding:16px}.room-title{display:flex;justify-content:space-between;align-items:center}.room-title h3{font-size:25px;margin:1px 0;color:var(--gold)}.status{display:inline-flex;border:1px solid #604d2c;border-radius:99px;padding:4px 8px;color:#d8c48f;background:#241a15;font-size:10px;font-weight:800}.status-waiting,.status-starting{color:#f8cd53}.status-playing{color:#6fafff}.room-stats,.game-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.room-stats div,.game-stats div{display:grid;gap:3px}.room-stats small,.game-stats small,.cartela-summary small,.sticky-summary small,.stat small{font-size:9px;color:var(--muted);letter-spacing:.05em}.room-stats b,.game-stats b{font-size:13px}.primary-button{display:flex;justify-content:space-between;align-items:center;width:100%;border:0;border-radius:12px;padding:13px 15px;background:linear-gradient(110deg,#ffe36a,#dfa900);color:#251903;font-weight:850;box-shadow:0 5px 18px #ffc40020}.primary-button:disabled{box-shadow:none}.empty{display:grid;justify-items:center;gap:9px;padding:25px;text-align:center}.empty p{margin:0;color:var(--muted);font-size:13px}.empty-icon{font-size:30px}.howto{margin-top:18px;padding:16px}.howto h2{margin:6px 0 13px}.steps{display:grid;gap:9px}.steps span{font-size:13px}.steps b{color:var(--gold);margin-right:9px}.muted{color:var(--muted);font-size:12px}.howto .muted{margin-bottom:0}
.cartela-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:13px}.cartela-summary div,.sticky-summary div{display:grid;gap:4px}.cartela-summary b{font-size:12px}.legend{display:flex;gap:14px;margin:15px 0;color:var(--muted);font-size:11px}.legend span{display:flex;align-items:center;gap:5px}.legend i{width:10px;height:10px;border-radius:3px;background:#281a39}.legend .mine-dot{background:var(--gold)}.legend .taken-dot{background:var(--red)}.cartela-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;padding-bottom:15px}.cartela{aspect-ratio:1;display:grid;place-items:center;border:1px solid #49325d;border-radius:10px;background:#211330;color:#eee;font-weight:750}.cartela-mine{background:var(--gold);color:#211502;border-color:var(--gold-hi);box-shadow:0 0 13px #ffc40050}.cartela-taken{background:#66232c;color:#ffbec0;border-color:#a33840}.cartela.processing{animation:pulse 1s infinite}.sticky-summary{position:sticky;bottom:calc(76px + env(safe-area-inset-bottom));display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;margin-top:10px;z-index:2}.sticky-summary b{font-size:13px;color:var(--gold)}.sticky-summary .muted{font-size:10px}
.game-head{display:flex;justify-content:space-between;align-items:center}.game-head h2{margin:4px 0}.game-stats{grid-template-columns:repeat(4,1fr);padding:13px}.last-number{text-align:center;padding:15px;margin-top:12px}.last-number small{color:var(--muted);letter-spacing:.1em;font-size:10px}.last-number>strong{display:block;font-size:36px;color:var(--gold);text-shadow:0 0 18px #ffc40055}.recent{display:flex;justify-content:center;gap:7px;margin-top:8px}.recent span{border-radius:99px;background:#322045;padding:5px 9px;font-size:11px}.bingo-board{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;padding:8px}.bingo-column{display:grid;grid-template-rows:30px repeat(15,minmax(22px,1fr));gap:3px}.bingo-letter{display:grid;place-items:center;color:var(--gold);font-weight:900}.bingo-cell{display:grid;place-items:center;min-height:22px;border:1px solid #30223f;border-radius:5px;background:#130d1b;color:#ada5b8;font-size:10px}.bingo-cell.called{background:#1458a8;color:#fff;border-color:#448ded}.bingo-cell.latest{background:#2ba767;box-shadow:0 0 9px #22c55e66}.free{display:grid;place-items:center;background:#5c3b0b;color:#ffe36a!important}.player-card{margin-top:13px;padding:13px}.player-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.player-grid>*{display:grid;place-items:center;aspect-ratio:1;border-radius:6px;background:#120c19;font-size:11px}.player-grid b{color:var(--gold)}.player-grid .marked{background:#1458a8;color:#fff}.card-switch{display:flex;gap:8px;margin:10px 0}.card-switch button,.language-control button{border:1px solid #49365c;border-radius:9px;padding:8px;background:#170d21;color:var(--muted)}.card-switch .selected,.language-control .selected{border-color:var(--gold);color:var(--gold)}.danger-button{width:100%;margin-top:9px;padding:11px;border:1px solid #8a2834;border-radius:11px;background:#31131b;color:#ff9ba4;font-weight:700}
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:9;display:grid;grid-template-columns:repeat(4,1fr);width:min(100%,760px);padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#0c0614f2;border-top:1px solid #3b294d;backdrop-filter:blur(12px)}.bottom-nav button{display:grid;justify-items:center;gap:2px;border:0;background:transparent;color:#998ba9;font-size:10px}.bottom-nav button span{font-size:18px}.bottom-nav button.active{color:var(--gold)}
.page-title{margin:8px 0 18px;font-size:25px}.rank-list,.history-list{display:grid;gap:9px}.rank-row{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:8px;padding:13px}.rank-position{color:var(--gold);font-weight:900}.rank-row>span:nth-of-type(2){grid-column:2}.rank-row b{grid-column:3;grid-row:1 / span 2;color:var(--gold);font-size:11px}.history-item{padding:14px}.history-item p{margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px}.profile-card,.wallet-panel{display:grid;justify-items:center;padding:20px;margin-bottom:13px;text-align:center}.avatar{display:grid;place-items:center;width:60px;height:60px;border:2px solid var(--gold);border-radius:50%;background:#30203e;color:var(--gold);font-size:27px;font-weight:900}.profile-card h2{margin:9px 0 0}.profile-card>p{margin:2px}.profile-stats{display:grid;grid-template-columns:repeat(2,1fr);width:100%;gap:8px;margin:17px 0}.stat{display:grid;gap:4px;padding:11px;border:1px solid #382848;border-radius:10px;background:#140b1e}.stat b{font-size:12px}.settings{padding:15px}.settings .row{align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #352641}.language-control{display:flex;gap:5px}.wallet-panel{align-items:center;gap:9px}.wallet-panel>strong{font-size:28px;color:var(--gold)}.wallet-panel form{width:100%;text-align:left}.wallet-panel label{display:grid;gap:6px;margin:12px 0;color:var(--muted);font-size:12px}.wallet-panel input,.wallet-panel select{width:100%;padding:11px;border:1px solid #49365c;border-radius:9px;background:#0d0713;color:white}.payment-details{padding:10px;border-radius:9px;background:#120b1c;color:var(--gold);font-size:12px}.winner{text-align:center;padding:24px;margin-top:10px}.winner-crown{font-size:55px;color:var(--gold);text-shadow:0 0 24px #ffc40088;animation:crown 2s ease-in-out infinite}.winner h1{margin:5px;color:var(--gold);font-size:40px}.winner-row{display:grid;gap:4px;padding:12px;margin:10px 0;border:1px solid #49365c;border-radius:11px;background:#130b1b}.winner-row span{color:var(--muted);font-size:12px}.winner-row b{color:var(--gold)}.alert{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:10px 15px;padding:11px;border:1px solid #8d3238;border-radius:11px;background:#31141e;color:#ffc2c5;font-size:12px}.alert button{flex:none;border:1px solid #d47b7f;border-radius:8px;background:transparent;padding:6px;color:white}
.cartela-mine{background:#22c55e;color:#041b0c;border-color:#86efac;box-shadow:0 0 13px #22c55e50}.legend .mine-dot{background:#22c55e}
.app-shell{max-width:430px;min-height:100vh;min-height:100dvh;padding-bottom:calc(76px + env(safe-area-inset-bottom))}
.topbar{gap:8px;padding:calc(7px + env(safe-area-inset-top)) 8px 7px;background:#08040fee;border-bottom-color:#21162b}
.brand-mark{gap:7px;letter-spacing:.04em;font-size:10px}
.brand-icon{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:10px;background:linear-gradient(145deg,#ffe36a,#dba714);font-size:19px;box-shadow:0 2px 10px #dba71440}
.brand-copy{display:grid;gap:1px}
.brand-copy b{color:var(--gold);font-size:10px}
.brand-copy small{color:#a99cb5;font-size:8px;font-weight:500;letter-spacing:0}
.wallet-chip{display:flex;align-items:center;gap:5px;margin-left:auto;border-color:#493263;background:#160d21;padding:5px 9px;font-size:9px}
.wallet-chip span{font-size:11px}.wallet-chip small{color:#a99cb5;font-size:8px;font-weight:600}
.content{padding:9px 5px 20px}
.play-screen{display:grid;gap:10px}
.play-screen .hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;min-height:130px;padding:11px 8px 10px;border:1px solid #765723;border-radius:16px;background:radial-gradient(ellipse at 50% 0,#261337 0,transparent 76%),#100819;box-shadow:none;text-align:center}
.hero-crown{height:32px;font-size:27px;line-height:32px;filter:drop-shadow(0 2px 4px #ffcb3280)}
.play-screen .hero h1{margin:1px 0 3px;font-size:18px;line-height:1.15;letter-spacing:.005em}
.play-screen .hero h1 b{color:var(--gold);text-shadow:none}
.play-screen .hero p{font-size:9px;line-height:1.3}
.play-screen .features{display:flex;justify-content:center;gap:5px;width:100%;margin:9px 0 0;padding:0;border:0;overflow:visible;font-size:7px;color:#e9def1}
.play-screen .features span{flex:0 1 auto;min-width:0;padding:4px 6px;border:1px solid #45304f;border-radius:99px;white-space:nowrap;line-height:1}
.play-screen .section-heading{margin:0;min-height:7px}
.play-screen .section-heading h2{margin:0;color:#b898dc;font-size:8px;line-height:1.2;letter-spacing:.19em}
.play-screen .room-list{grid-template-columns:minmax(0,1fr);gap:9px}
.play-screen .room-card{padding:11px 12px;border-color:#765723;border-radius:17px;background:#100819;box-shadow:none}
.play-screen .room-title{display:flex;justify-content:flex-start;gap:8px;min-width:0}
.room-emblem{display:grid;place-items:center;flex:none;width:40px;height:40px;border:1px solid #6f5018;border-radius:12px;background:#1b1225;color:#f4e7cb;font-size:19px}
.room-description{display:grid;align-content:center;gap:2px;flex:1;min-width:0}
.play-screen .room-title h3{overflow:hidden;margin:0;color:#fff;font-size:11px;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.room-description small{overflow:hidden;color:#9d8fac;font-size:7px;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.join-button{flex:none;min-width:73px;min-height:37px;border:0;border-radius:11px;background:linear-gradient(110deg,#ffdc4c,#f2b91d);color:#251903;font-size:12px;font-weight:900;box-shadow:0 3px 10px #dcae1930}
.play-screen .room-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:9px 0 0}
.play-screen .room-stats div{display:flex;min-width:0;min-height:40px;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:4px 2px;border:1px solid #2c1e39;border-radius:9px;background:#0c0613;text-align:center}
.play-screen .room-stats b{font-size:9px;line-height:1.25}
.play-screen .room-stats small{font-size:7px;line-height:1.2;letter-spacing:.02em}
.play-screen .empty{padding:16px 10px;border-radius:15px}
.play-screen .empty strong{font-size:11px}
.play-screen .empty p{font-size:9px}
.play-screen .empty .outline-button{padding:6px 10px;font-size:10px}
.play-smart{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:54px;margin:0;padding:8px 10px;border-color:#493263;border-radius:15px;background:#100819;box-shadow:none}
.play-smart h2{margin:0 0 2px;color:var(--gold);font-size:9px;line-height:1.2}
.play-smart p{margin:0;color:#a99cb5;font-size:7px;line-height:1.35}
.play-smart>span{flex:none;color:#ee6568;font-size:20px}
.how-to{display:grid;gap:6px}
.how-to>h2{margin:0;color:#b898dc;font-size:8px;line-height:1.2;letter-spacing:.19em}
.how-to-card{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;min-height:53px;padding:7px 5px;border-color:#493263;border-radius:15px;background:#100819;box-shadow:none}
.how-to-card>div{display:flex;min-width:0;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center}
.how-to-card b{display:grid;place-items:center;width:18px;height:18px;border-radius:3px;background:#9ac3d4;color:#122231;font-size:12px;line-height:1}
.how-to-card span{color:#b5a8c0;font-size:7px;line-height:1.2;white-space:nowrap}
.bottom-nav{left:50%;width:min(100%,430px);padding:6px 8px calc(6px + env(safe-area-inset-bottom));background:#090510f5;border-top-color:#21162b}
.bottom-nav button{gap:1px;font-size:8px}
.bottom-nav button span{font-size:17px}
@media(max-width:370px){.content{padding-right:5px;padding-left:5px}.play-screen .features{gap:3px}.play-screen .features span{padding:4px 4px;font-size:6px}.room-description small{font-size:6.5px}.join-button{min-width:66px;font-size:11px}.how-to-card span{font-size:6px}}
@media(min-width:600px){.app-shell{max-width:430px}.content{padding:10px 6px 20px}.hero-crown{height:32px}.play-screen .hero{min-height:130px;padding:11px 8px 10px}.play-screen .features{margin-top:9px}.play-screen .room-list{grid-template-columns:minmax(0,1fr)}.bottom-nav{width:min(100%,430px)}}
@keyframes crown{50%{transform:translateY(-4px) rotate(3deg);text-shadow:0 0 34px #ffc400cc}}@keyframes pulse{50%{opacity:.55}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
@media(min-width:600px){.content{padding:22px 24px 36px}.cartela-grid{grid-template-columns:repeat(10,minmax(0,1fr))}.cartela{font-size:15px}.hero{min-height:230px;padding:27px}.features{margin-top:32px}.room-list{grid-template-columns:repeat(2,minmax(0,1fr))}.bottom-nav{border-radius:18px 18px 0 0}}
.cartela-page-heading{display:grid;justify-items:center;gap:4px;margin:8px 0 12px;text-align:center}
.cartela-page-heading h1{margin:0;font-size:19px}
.room-info-card,.selection-overview{margin:10px 0;padding:12px;border-radius:15px}
.room-info-heading{display:flex;align-items:center;justify-content:space-between;padding-bottom:9px;border-bottom:1px solid #342542}
.room-info-heading>div{display:grid;gap:2px}.room-info-heading small,.room-info-grid small,.selection-overview small{color:var(--muted);font-size:9px;letter-spacing:.08em}
.room-info-heading b{font-size:14px}
.room-info-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.room-info-grid>div{display:grid;gap:3px;min-width:0}
.room-info-grid b{font-size:11px;overflow-wrap:anywhere}
.selection-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.selection-overview>div{display:grid;gap:3px;min-width:0}
.selection-overview b{font-size:12px;overflow-wrap:anywhere}
.cartela-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0 8px}
.cartela-section-title h2{margin:0;color:var(--gold);font-size:11px;letter-spacing:.09em}
.cartela-section-title p{margin:3px 0 0;color:var(--muted);font-size:10px}
.cartela-section-title .outline-button{flex:none;padding:7px 9px;font-size:10px}
.legend{flex-wrap:wrap;gap:10px;margin:9px 0;font-size:9px}
.cartela-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;padding-bottom:12px}
.cartela{position:relative;min-width:0;min-height:48px;aspect-ratio:1.15;border-color:#49325d;background:#211330;transition:transform .12s,border-color .12s,background .12s}
.cartela:active{transform:scale(.95)}
.cartela-mine{background:#16a34a;color:#fff;border-color:#4ade80;box-shadow:0 0 10px #16a34a55}
.cartela-mine b,.cartela-taken b{position:absolute;top:2px;right:3px;font-size:9px}
.cartela-taken{background:#b91c1c;color:#fff;border-color:#ef4444;opacity:1}
.cartela-taken b{font-size:8px}
.cartela.processing{animation:pulse .8s infinite}
.cartela-notice,.room-closed-note{margin:7px 0;padding:9px 10px;border:1px solid #493263;border-radius:10px;background:#170d21;color:#e4d9ed;font-size:11px}
.room-closed-note{border-color:#725621;color:#ffe3a1}
.selection-footer{position:sticky;bottom:calc(8px + env(safe-area-inset-bottom));z-index:4;display:grid;gap:8px;margin:10px 0 14px;padding:12px;border-color:#76551b;border-radius:15px;background:#130b1dee;box-shadow:0 6px 24px #0009;backdrop-filter:blur(10px)}
.selection-footer-details{display:grid;grid-template-columns:1fr auto;gap:3px 8px;align-items:center}
.selection-footer-details strong{font-size:11px;color:var(--gold)}
.selection-footer-details span{min-width:0;overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.selection-footer-details>b{grid-column:2;grid-row:1 / span 2;text-align:right;font-size:13px}
.selection-footer-details small{color:var(--muted);font-size:9px;font-weight:500}
.selection-footer>.primary-button{justify-content:center;min-height:42px;padding:10px 12px;font-size:12px}
.selection-footer-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:9px}
.selection-footer-actions .text-button{max-width:60%;padding:4px;color:#f2a2a2;font-size:9px;text-align:right}
.modal-backdrop{position:fixed;inset:0;z-index:30;display:flex;align-items:flex-end;justify-content:center;padding:12px 10px calc(12px + env(safe-area-inset-bottom));background:#05020bd9}
.cartela-preview{position:relative;width:min(100%,420px);max-height:90dvh;overflow:auto;padding:18px 15px 15px;border-color:#76551b;border-radius:20px;background:#130b1d;box-shadow:0 16px 50px #000b}
.preview-close{position:absolute;top:10px;right:11px;width:32px;height:32px;border:1px solid #493263;border-radius:50%;background:#1b1028;color:#e8dff0;font-size:22px;line-height:1}
.cartela-preview h2{margin:4px 34px 8px 0;font-size:17px}
.preview-state{margin:8px 0;padding:8px;border:1px solid #493263;border-radius:9px;color:#d4c7df;font-size:10px;font-weight:800;text-align:center}
.preview-mine{border-color:#16a34a;background:#0d321c;color:#86efac}
.preview-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
.preview-column{display:grid;grid-template-rows:30px repeat(5,minmax(37px,1fr));gap:4px}
.preview-column>*{display:grid;place-items:center;min-width:0;border:1px solid #382747;border-radius:7px;background:#0e0815;color:#f8f5fb;font-size:12px;font-weight:700}
.preview-column>b{border-color:#76551b;background:#261a0d;color:var(--gold);font-size:15px}
.preview-column .preview-free{background:#5b3b0b;color:#ffe36a;font-size:8px}
.preview-actions{display:grid;gap:7px;margin-top:12px}
.preview-actions>p,.deselect-confirm>p{margin:0;color:var(--muted);font-size:11px;text-align:center}
.preview-actions .primary-button,.preview-actions .danger-button{justify-content:center;min-height:42px}
.deselect-confirm{display:grid;gap:9px;margin-top:12px;padding:10px;border:1px solid #76551b;border-radius:11px;background:#1a1120}
.deselect-confirm>div{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.deselect-confirm .outline-button,.deselect-confirm .danger-button{width:100%;margin:0;padding:9px 6px;font-size:10px}
.waiting-room{display:grid;justify-items:center;gap:10px;margin-top:12px;padding:20px 14px;border-radius:18px;text-align:center}
.waiting-crown{font-size:38px}
.waiting-room h1{margin:0;font-size:21px}
.waiting-room>p{margin:0;color:var(--muted);font-size:12px}
.waiting-room .room-info-grid{width:100%;text-align:left}
.waiting-room>.primary-button,.waiting-room>.outline-button,.waiting-room>.danger-button{justify-content:center;width:100%;margin:0;padding:10px;font-size:11px}
@media(max-width:370px){.cartela-grid{gap:5px}.cartela{min-height:42px;font-size:12px}.cartela-section-title h2{font-size:10px}.selection-overview{gap:8px;padding:10px}.selection-overview b{font-size:10px}}
@media(min-width:600px){.cartela-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.modal-backdrop{align-items:center}.cartela-preview{max-height:85vh}.cartela{min-height:52px}}
.cartela-topline{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin:0 2px 10px;color:#a997ba;font-size:10px;font-weight:750;letter-spacing:.08em}
.cartela-topline .text-button{justify-self:start;color:#b8a6cc;font-size:12px}
.cartela-topline .cartela-leave{justify-self:end;color:#ff9ba4}
.cartela-title{margin:0 0 11px;color:#aa83d7;font-size:15px;font-weight:900;letter-spacing:.14em}
.cartela-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:0 0 10px;padding:6px;border-color:#3d2754;border-radius:17px;background:#100819}
.cartela-metrics>div{display:grid;justify-items:center;gap:3px;min-width:0;padding:9px 3px;border:1px solid #39264c;border-radius:13px;background:#130a1e;text-align:center}
.cartela-metrics small{color:#9d87b3;font-size:8px;font-weight:850;letter-spacing:.08em}
.cartela-metrics b{max-width:100%;overflow:hidden;color:#f7f1fd;font-size:13px;text-overflow:ellipsis;white-space:nowrap}
.cartela-metrics>div:nth-child(2) b,.cartela-metrics>div:nth-child(3) b{color:#ffd34d}
.cartela-metrics span{color:#a998b9;font-size:7px;font-weight:750}
.countdown-panel{display:grid;gap:8px;margin:0 0 10px;padding:12px;border-color:#3d2754;border-radius:16px;background:#140b20}
.countdown-copy{display:flex;align-items:center;justify-content:space-between;gap:8px}
.countdown-copy>div{display:grid;gap:2px}
.countdown-copy small{color:#a78bc2;font-size:8px;font-weight:850;letter-spacing:.1em}
.countdown-copy strong{color:#fff;font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums}
.countdown-status{color:#c6a4e9;font-size:8px;font-weight:900;letter-spacing:.07em;text-align:right}
.countdown-status.players-ready{color:#70e59b}
.countdown-track{height:5px;overflow:hidden;border-radius:99px;background:#2c1d3b}
.countdown-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#8d58d1,#ffd047);transition:width .25s linear}
.countdown-panel>p{margin:0;color:#b9a8ca;font-size:9px;font-weight:750;letter-spacing:.04em}
.cartela-picker{margin:0 0 11px;padding:11px 9px;border-color:#3d2754;border-radius:18px;background:#140b20}
.cartela-picker-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 3px 0}
.cartela-picker-heading h2{margin:0;color:#faf6ff;font-size:12px;font-weight:900}
.cartela-picker-heading>span{color:#b5a2c8;font-size:9px}
.cartela-picker-summary{margin:7px 3px 10px;color:#a996ba;font-size:9px}
.cartela-picker .cartela-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:3px 1px 10px}
.cartela-picker .cartela{position:relative;display:grid;place-items:center;min-width:0;min-height:51px;aspect-ratio:1;border:1px solid #3c294e;border-radius:12px;background:#180e26;color:#aa9ab9;font-size:12px;font-weight:800}
.cartela-picker .cartela-mine{border-color:#60df91;background:#168c4b;color:#fff;box-shadow:0 0 12px #16a34a44}
.cartela-picker .cartela-mine b,.cartela-picker .cartela-taken b{position:absolute;top:2px;right:3px;font-size:8px}
.cartela-picker .cartela-taken{border-color:#a44350;background:#64232d;color:#ffbdc4}
.cartela-picker .cartela:disabled{cursor:not-allowed}
.cartela-picker .cartela.processing{animation:pulse .8s infinite}
.cartela-legend{display:flex;flex-wrap:wrap;gap:12px;padding:2px 3px 8px;color:#b7a6c8;font-size:8px}
.cartela-legend span{display:flex;align-items:center;gap:4px}
.cartela-legend i{width:8px;height:8px;border-radius:3px;background:#241430}
.cartela-legend .mine-dot{background:#22c55e}
.cartela-legend .taken-dot{background:#b83242}
.cartela-refresh{width:100%;padding:8px;font-size:10px}
.selected-previews{display:grid;gap:9px;margin:12px 0 18px}
.selected-previews>h2{display:flex;justify-content:space-between;align-items:center;margin:0;color:#aa83d7;font-size:11px;font-weight:900;letter-spacing:.1em}
.selected-previews>h2 span{color:#c3b3d2;font-size:10px;letter-spacing:0}
.selected-cartela{padding:11px;border-color:#3d2754;border-radius:16px;background:#140b20}
.selected-cartela>header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.selected-cartela>header>div{display:grid;gap:2px}
.selected-cartela>header strong{color:#fff;font-size:11px}
.selected-cartela>header small{color:#a996ba;font-size:8px}
.selected-cartela>header>span{color:#65df92;font-size:8px;font-weight:900;letter-spacing:.07em}
.selected-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
.selected-column{display:grid;grid-template-rows:25px repeat(5,minmax(31px,1fr));gap:3px}
.selected-column>*{display:grid;place-items:center;min-width:0;border:1px solid #39264c;border-radius:6px;background:#100819;color:#eee5f7;font-size:10px;font-weight:750}
.selected-column>b{border-color:#51366b;background:#251632;color:#d5b0ff;font-size:12px}
.selected-column .selected-free{background:#4c3511;color:#ffdc70;font-size:7px}
.selected-cartela>footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;color:#ffd34d;font-size:10px;font-weight:850}
.selected-cartela>footer .danger-button{width:auto;margin:0;padding:7px 9px;font-size:8px}
.selected-empty{margin:0;padding:13px;border-color:#39264c;color:#a996ba;font-size:9px}
.cartela-notice{margin:0 0 9px;padding:8px 10px;border:1px solid #493263;border-radius:10px;background:#170d21;color:#e4d9ed;font-size:10px}
@media(max-width:370px){.cartela-picker .cartela-grid{grid-template-columns:repeat(8,minmax(0,1fr));gap:4px}.cartela-picker .cartela{min-height:36px;border-radius:8px;font-size:10px}.selected-column{grid-template-rows:22px repeat(5,minmax(27px,1fr))}}
@media(min-width:371px){.cartela-picker .cartela-grid{grid-template-columns:repeat(8,minmax(0,1fr))}}
@media(min-width:600px){.cartela-picker .cartela-grid{grid-template-columns:repeat(10,minmax(0,1fr))}.cartela-picker .cartela{min-height:44px}.selected-board{max-width:400px}}
.cartela-room-footer{position:sticky;bottom:calc(8px + env(safe-area-inset-bottom));z-index:4;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 5px;padding:10px;border-color:#493263;border-radius:15px;background:#150c20f2;box-shadow:0 8px 26px #05020bbb;backdrop-filter:blur(12px)}
.cartela-room-footer>div{display:grid;justify-items:center;gap:3px;min-width:0}
.cartela-room-footer>div>b{overflow:hidden;color:#f7f1fd;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.cartela-room-footer>div>small{color:#a996ba;font-size:7px;font-weight:850;letter-spacing:.08em}
.cartela-room-footer>.danger-button{grid-column:1/-1;justify-content:center;width:100%;margin:0;padding:10px;font-size:10px}
.cartela-app-shell{max-width:430px;padding:0 0 calc(112px + env(safe-area-inset-bottom));background:#0f0920}
.cartela-app-shell>.content{padding:0}
.cartela-app-shell .cartela-screen{min-height:100dvh;padding-bottom:8px;background:#0f0920}
.cartela-screen-header{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:88px;padding:calc(10px + env(safe-area-inset-top)) 14px 12px;background:#0f0920;text-align:center}
.cartela-back{justify-self:start;padding:8px 10px;border:0;border-radius:22px;background:#0b0716;color:#fff;font-size:14px;font-weight:700}
.cartela-brand-title{display:grid;gap:3px}
.cartela-brand-title strong{color:#d8b84c;font-size:15px;font-weight:900;letter-spacing:.16em;white-space:nowrap}
.cartela-brand-title small{color:#a89abc;font-size:9px;font-weight:800;letter-spacing:.24em}
.cartela-hud{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px 14px 13px;background:#211331;border-bottom:1px solid #2d1b54}
.cartela-hud-card{display:grid;align-content:center;justify-items:center;min-width:0;min-height:56px;padding:7px 3px;border:1px solid #2d1b54;border-radius:7px;background:#130a20;text-align:center}
.cartela-hud-card small{color:#9d93a9;font-size:10px;font-weight:800;letter-spacing:.04em}
.cartela-hud-card b{max-width:100%;overflow:hidden;margin-top:3px;color:#fff;font-size:15px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.cartela-hud-card.pot b{color:#e3c24f}
.cartela-hud-card.starts-in b{color:#ef4444}
.cartela-grid-8col{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;padding:12px 14px}
.cartela-btn{display:flex;align-items:center;justify-content:center;min-width:0;aspect-ratio:1;border:1px solid #49316c;border-radius:10px;background:#281a4a;color:#fff;font-size:14px;font-weight:800;line-height:1;touch-action:manipulation;transition:transform .08s ease}
.cartela-btn:active{transform:scale(.92)}
.cartela-btn.taken{border-color:#6b1d31;background:#521626;color:#ffffff66;pointer-events:none}
.cartela-btn.mine{border-color:#35dbad;background:#10b981;color:#fff;box-shadow:0 0 10px #10b98166}
.cartela-btn:disabled{opacity:1}.cartela-btn.loading{border-color:#49316c;background:#281a4a;color:#fff8}
.cartela-previews{display:grid;gap:9px;padding:2px 14px 18px}
.cartela-preview-placeholder{margin:0;padding:12px 2px;color:#8b7fa8;font-size:12px;text-align:center}
.cartela-preview-card{padding:10px;border:1px solid #2d1b54;border-radius:12px;background:#1c1033}
.cartela-preview-card h2{margin:0 0 8px;color:#efeaf8;font-size:13px}
.cartela-preview-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
.cartela-preview-column{display:grid;grid-template-rows:24px repeat(5,minmax(29px,1fr));gap:3px}
.cartela-preview-column>*{display:grid;place-items:center;min-width:0;border:1px solid #33234b;border-radius:5px;background:#130a20;color:#f7f3fc;font-size:10px;font-weight:750}
.cartela-preview-column>b{background:#281a4a;color:#d8b84c;font-size:12px}
.cartela-preview-column .free{background:#5b4215;color:#ffe284;font-size:8px}
.cartela-bottom-hud{position:fixed;bottom:0;left:50%;z-index:8;display:grid;gap:11px;width:min(100%,430px);padding:13px 14px calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);border-top:1px solid #2d1b54;background:#1c1033f5;box-shadow:0 -9px 25px #090414a8;backdrop-filter:blur(12px)}
.cartela-bottom-counts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:center;text-align:center}
.cartela-bottom-counts span{overflow:hidden;color:#f5f0fc;font-size:13px;font-weight:850;text-overflow:ellipsis;white-space:nowrap}
.cartela-leave-button{min-height:42px;border:1px solid #35214f;border-radius:13px;background:#1b1030;color:#9286a6;font-size:13px;font-weight:850;letter-spacing:.04em}
.cartela-leave-button:disabled{opacity:.5}
.cartela-toast{position:fixed;bottom:calc(112px + env(safe-area-inset-bottom));left:50%;z-index:12;width:max-content;max-width:calc(100% - 30px);padding:9px 14px;transform:translateX(-50%);border:1px solid #4a3365;border-radius:11px;background:#201433;color:#fff;font-size:12px;font-weight:700;text-align:center;box-shadow:0 5px 18px #0008}
.cartela-closed-note,.cartela-load-error{margin:8px 14px;padding:9px 10px;border:1px solid #573b2a;border-radius:10px;background:#20152a;color:#edc47c;font-size:11px}
@media(max-width:360px){.cartela-grid-8col{gap:4px;padding-right:10px;padding-left:10px}.cartela-btn{border-radius:8px;font-size:12px}.cartela-hud{gap:5px;padding-right:10px;padding-left:10px}.cartela-hud-card small{font-size:8px}.cartela-hud-card b{font-size:13px}}
@media(min-width:600px){.cartela-grid-8col{gap:8px;padding-right:20px;padding-left:20px}.cartela-btn{font-size:15px}}
.game-app-shell{width:100%;max-width:900px;height:100dvh;min-height:100dvh;overflow:hidden;padding:0;background:#0f0920}
.game-app-shell>.content{height:100%;overflow:hidden;padding:0}
.game-app-shell .live-game{display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto auto auto;gap:7px;width:100%;height:100dvh;min-height:0;overflow:hidden;padding:calc(7px + env(safe-area-inset-top)) 10px calc(7px + env(safe-area-inset-bottom));background:radial-gradient(ellipse at 50% -16%,#2c1945 0,transparent 48%),#0f0920}
.live-game-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:38px}
.live-back,.live-refresh{min-height:32px;border:1px solid #342451;border-radius:10px;background:#1c1033;color:#ded4ed;font-size:11px;font-weight:800}
.live-back{justify-self:start;padding:5px 9px}.live-refresh{justify-self:end;width:34px;font-size:20px;line-height:1}
.live-brand{display:grid;gap:1px;text-align:center}.live-brand strong{color:#f1d46b;font-size:12px;letter-spacing:.14em}.live-brand small{color:#9d91ae;font-size:8px;font-weight:800;letter-spacing:.08em}
.live-game-hud{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.live-game-hud>div{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:1px 5px;min-width:0;padding:5px 7px;border:1px solid #30204a;border-radius:10px;background:#1c1033}
.live-game-hud small{grid-column:1/-1;color:#998eaa;font-size:8px;font-weight:850;letter-spacing:.08em}
.live-game-hud b{overflow:hidden;color:#fff;font-size:13px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.live-game-hud i{justify-self:end;color:#9486a6;font-size:7px;font-style:normal;font-weight:800}
.live-game-hud>div:first-child b{color:#f6c954}.live-game-hud .live-status{font-size:10px;color:#80e6b5}
.live-call-strip{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;min-height:62px;padding:6px 10px;border:1px solid #392650;border-radius:12px;background:#1b102c}
.live-current-call{display:grid;justify-items:center;min-width:72px;padding:2px 9px;border-right:1px solid #423153}
.live-current-call small,.live-recent-calls>small{color:#a396b3;font-size:7px;font-weight:850;letter-spacing:.08em;white-space:nowrap}
.live-current-call strong{color:#ffe17a;font-size:24px;font-weight:950;line-height:1.1;text-shadow:0 0 16px #f1b92b66;animation:call-pop .28s ease-out}
.live-recent-calls{min-width:0}.live-recent-calls>div{display:flex;align-items:center;gap:5px;min-height:24px;overflow:hidden;margin-top:4px}
.live-recent-calls span{flex:none;padding:4px 6px;border:1px solid #37284a;border-radius:7px;background:#110a1c;color:#cfc3dc;font-size:8px;font-weight:800}
.live-recent-calls .recent-current{border-color:#8f6d26;background:#392b17;color:#ffe17a}.live-recent-calls .recent-empty{border:0;background:transparent;color:#9387a2;font-weight:500}
.live-board-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px;min-height:0}
.live-board-panel{display:flex;min-width:0;min-height:0;flex-direction:column;overflow:hidden;padding:7px;border:1px solid #30204a;border-radius:12px;background:#1a1028}
.live-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:4px;min-height:32px;margin-bottom:4px}
.live-panel-heading>div{display:grid;gap:1px;min-width:0}.live-panel-heading small{color:#9789a8;font-size:7px;font-weight:850;letter-spacing:.1em}.live-panel-heading h2{overflow:hidden;margin:0;color:#f5efff;font-size:10px;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
.live-panel-heading>span{flex:none;color:#f4d77d;font-size:9px;font-weight:850}
.live-master-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;flex:1;min-height:0}
.live-master-column{display:flex;min-width:0;min-height:0;flex-direction:column;gap:2px}
.live-master-letter{display:grid;place-items:center;flex:none;height:18px;border-radius:5px;background:#33224d;color:#f7e7b0;font-size:10px}
.live-master-number{display:grid;place-items:center;flex:1;min-height:0;overflow:hidden;border:1px solid #30213e;border-radius:3px;background:#120b1c;color:#a99cb8;font-size:clamp(7px,2.3vw,11px);font-weight:700;font-variant-numeric:tabular-nums}
.live-master-number.called{border-color:#594478;background:#392b4e;color:#ded0f0}.live-master-number.latest{border-color:#f5ca5e;background:#f0c552;color:#231805;box-shadow:0 0 9px #f5ca5e77}
.live-card-tabs{display:flex;gap:4px;margin:0 0 4px}.live-card-tabs button{flex:1;padding:4px;border:1px solid #38284b;border-radius:6px;background:#120b1c;color:#aa9bbd;font-size:8px;font-weight:800}.live-card-tabs button.selected{border-color:#10b981;background:#0f4836;color:#b1f5d6}
.player-panel>.player-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(6,minmax(0,1fr));gap:3px;flex:1;min-height:0}
.player-grid>b{display:grid;place-items:center;min-width:0;border-radius:4px;background:#33224d;color:#f1d777;font-size:10px}
.player-grid>span{display:grid;place-items:center;min-width:0;min-height:0;overflow:hidden;border:1px solid #382b48;border-radius:4px;background:#110b1a;color:#e4dcea;font-size:clamp(8px,2.5vw,12px);font-weight:850}
.player-grid>span.marked{border-color:#10a76f;background:#12533c;color:#e1fff0}.player-grid>span.free{color:#ffe17a}.player-grid>span.winning-cell{border-color:#ffe27c;background:#f0c552;color:#261904;box-shadow:0 0 10px #f6cb5d99;animation:winning-glow 1.1s ease-in-out infinite alternate}
.spectator-message{display:grid;align-content:center;justify-items:center;flex:1;gap:8px;padding:12px;text-align:center}.spectator-message span{font-size:24px}.spectator-message strong{color:#e7dafa;font-size:12px}.spectator-message small{color:#a394b5;font-size:9px;line-height:1.5}
.live-card-progress{display:grid;grid-template-columns:1fr auto;gap:3px 6px;padding-top:5px;color:#a89bb7;font-size:8px}.live-card-progress b{color:#c9f3dc}.live-card-progress>div{grid-column:1/-1;height:3px;overflow:hidden;border-radius:9px;background:#342842}.live-card-progress i{display:block;height:100%;border-radius:9px;background:#10b981}
.live-lower-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;min-height:39px}.live-pattern-note{overflow:hidden;color:#b3a6c2;font-size:9px;line-height:1.3;text-overflow:ellipsis}
.live-bingo-button{min-width:92px;min-height:34px;padding:6px 11px;border:0;border-radius:9px;background:linear-gradient(110deg,#ffe17a,#e6a91f);color:#261903;font-size:10px;font-weight:950;letter-spacing:.06em}.live-bingo-button:disabled{filter:saturate(.25);opacity:.4}
.live-activity{display:flex;min-height:48px;flex-direction:column;justify-content:center;gap:3px;padding:5px 8px;border:1px solid #2e2140;border-radius:9px;background:#170e23}
.live-activity-heading{display:flex;align-items:center;justify-content:space-between;gap:4px}.live-activity-heading>div{display:flex;align-items:center;gap:6px}.live-activity-heading small{color:#9386a4;font-size:7px;font-weight:850}.live-activity-heading strong{color:#e5d9f0;font-size:9px}.live-activity-heading button{border:0;background:transparent;color:#bda6dc;font-size:8px}
.live-activity>p{margin:0;color:#9386a4;font-size:8px}.live-activity-list{display:flex;gap:8px;overflow:hidden}.live-activity-list span{overflow:hidden;color:#c2b4d0;font-size:7px;text-overflow:ellipsis;white-space:nowrap}
.live-game-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;padding:0 2px;color:#8e819e;font-size:7px;font-weight:850;letter-spacing:.08em}
.live-game-footer button{padding:6px 10px;border:1px solid #392b4d;border-radius:8px;background:#1b1029;color:#c5b5d4;font-size:8px;font-weight:850;letter-spacing:.05em}
.game-feedback{position:fixed;top:calc(env(safe-area-inset-top) + 8px);left:50%;z-index:20;display:flex;align-items:center;gap:8px;width:max-content;max-width:calc(100% - 22px);padding:8px 12px;transform:translateX(-50%);border:1px solid #784043;border-radius:9px;background:#3c1727;color:#ffcfcb;font-size:10px;box-shadow:0 4px 18px #0009}
.game-feedback button{border:0;background:transparent;color:inherit;font-size:16px}
.winner-celebration{position:relative;display:grid;justify-items:center;gap:10px;max-width:510px;margin:0 auto;padding:24px 14px 20px;overflow:hidden;text-align:center}
.winner-celebration h1{margin:0;color:#f6d36c;font-size:clamp(36px,12vw,56px);font-weight:1000;letter-spacing:.06em;text-shadow:0 0 26px #f0c85a66}.winner-celebration>.eyebrow{color:#bda8db}
.winner-trophy{z-index:1;font-size:58px;line-height:1;filter:drop-shadow(0 0 20px #ffd45899);animation:trophy-bounce 1.2s ease-in-out infinite alternate}
.winner-subtitle{margin:0;color:#c7b9d5;font-size:13px}
.winner-podium{z-index:1;display:grid;justify-items:center;gap:4px;width:100%;padding:14px 10px;border:1px solid #73551e;border-radius:15px;background:linear-gradient(145deg,#2b1d31,#17101f);box-shadow:0 0 26px #ebbd4230}
.winner-podium small,.winner-card-title{color:#e6c761;font-size:9px;font-weight:900;letter-spacing:.13em}.winner-podium>strong{color:#fff;font-size:20px}.winner-podium>span{color:#c4b4d1;font-size:10px}.winner-podium>b{color:#ffdf70;font-size:22px}
.winner-card-section{z-index:1;width:100%;max-width:390px;padding:10px;border:1px solid #47355d;border-radius:13px;background:#1b1129}
.winner-card-title{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.winner-card-title small{color:#a899b9;font-size:8px}
.winner-player-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(6,minmax(38px,1fr));gap:4px}
.winner-player-grid>b{display:grid;place-items:center;border-radius:5px;background:#33224d;color:#f1d777}.winner-player-grid>span{display:grid;place-items:center;min-height:38px;border:1px solid #382b48;border-radius:5px;background:#110b1a;color:#eee5f4;font-size:12px;font-weight:850}.winner-player-grid>span.marked{background:#12533c;color:#e1fff0}.winner-player-grid>span.winning-cell{border-color:#ffe27c;background:#f0c552;color:#261904;box-shadow:0 0 12px #f6cb5d99}
.winner-list{display:grid;gap:5px;width:100%}.winner-list>div{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:8px 10px;border:1px solid #332742;border-radius:9px;background:#181021;text-align:left}.winner-list>div>span{color:#ab9bbd;font-size:9px}.winner-list>div>strong{grid-column:2;grid-row:1/3;align-self:center;color:#f3d36e;font-size:11px}
.winner-round-stats{display:flex;justify-content:center;gap:24px;color:#f2e9f8;font-size:16px;font-weight:900}.winner-round-stats span{display:grid;gap:1px}.winner-round-stats small{color:#9f91ad;font-size:7px;letter-spacing:.08em}
.winner-home-button{width:100%;min-height:43px;border:0;border-radius:12px;background:linear-gradient(110deg,#ffe17a,#e6a91f);color:#261903;font-size:11px;font-weight:950;letter-spacing:.08em}
.winner-confetti{position:absolute;inset:0;pointer-events:none}.winner-confetti i{position:absolute;color:#f4d263;font-size:18px;font-style:normal;animation:confetti-fall 2.8s ease-in-out infinite}.winner-confetti i:nth-child(1){left:9%;top:5%;animation-delay:-.5s}.winner-confetti i:nth-child(2){left:86%;top:8%;animation-delay:-1.4s;color:#ba95f4}.winner-confetti i:nth-child(3){left:20%;top:26%;animation-delay:-2s}.winner-confetti i:nth-child(4){left:76%;top:32%;animation-delay:-.9s;color:#73deb1}.winner-confetti i:nth-child(5){left:48%;top:2%;animation-delay:-1.8s}
@keyframes call-pop{from{transform:scale(.65);opacity:.4}to{transform:scale(1);opacity:1}}@keyframes winning-glow{to{box-shadow:0 0 16px #f6cb5dcc;transform:scale(1.03)}}@keyframes trophy-bounce{to{transform:translateY(-4px) rotate(3deg)}}@keyframes confetti-fall{50%{transform:translateY(16px) rotate(90deg);opacity:.55}}
@media(max-height:650px){.game-app-shell .live-game{gap:4px;padding-top:calc(4px + env(safe-area-inset-top));padding-bottom:calc(4px + env(safe-area-inset-bottom))}.live-game-header{min-height:30px}.live-game-hud>div{padding:3px 5px}.live-call-strip{min-height:49px}.live-current-call strong{font-size:20px}.live-activity{min-height:38px}.live-board-panel{padding:5px}.live-master-letter{height:14px}.live-panel-heading{min-height:26px}}
@media(max-width:360px){.game-app-shell .live-game{padding-right:6px;padding-left:6px}.live-board-pair{gap:5px}.live-board-panel{padding:5px}.live-call-strip{gap:5px;padding-right:6px;padding-left:6px}.live-game-hud{gap:4px}.live-game-hud>div{padding-right:4px;padding-left:4px}.live-game-hud b{font-size:11px}.live-master-board,.player-panel>.player-grid{gap:2px}.live-master-number{font-size:7px}.live-activity-list span{font-size:6px}}
@media(prefers-reduced-motion:reduce){.live-current-call strong,.player-grid>span.winning-cell,.winner-trophy,.winner-confetti i{animation:none}}
.game-app-shell .live-game{grid-template-rows:auto auto minmax(0,1fr) auto;gap:6px}
.live-game-hud{grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;padding:7px 8px;border:1px solid #28174a;border-radius:9px;background:#0d071c}
.live-game-hud>div{display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;gap:2px;padding:4px 2px;border:1px solid #28174a;border-radius:7px;background:#170d2c}
.live-game-hud small{grid-column:auto;color:#8e7ea8;font-size:8px;letter-spacing:.04em}
.live-game-hud b{font-size:clamp(9px,2.8vw,13px);color:#fff}
.live-game-hud .pot b{color:#f59e0b}.live-game-hud .called b{color:#ef4444}
.live-play-arena{display:grid;grid-template-columns:minmax(0,.72fr) minmax(0,1.28fr);gap:7px;min-height:0;padding:0}
.master-panel{padding:4px;background:#120924}
.live-master-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:18px repeat(15,minmax(0,1fr));gap:2px;width:100%;height:100%;min-height:0;padding:3px;border-radius:7px;background:#120924}
.master-col-header{display:grid;place-items:center;min-width:0;border-radius:4px;color:#fff;font-size:10px;font-weight:900}
.master-col-header.b{background:#10b981}.master-col-header.i{background:#8b5cf6}.master-col-header.n{background:#f97316}.master-col-header.g{background:#3b82f6}.master-col-header.o{background:#ec4899}
.master-cell{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;border-radius:3px;background:#0a0515;color:#55486d;font-size:clamp(7px,2.2vw,10px);font-weight:750}
.master-cell.called{background:#2563eb;color:#fff;font-weight:900}.master-cell.current{background:#f97316;color:#fff;box-shadow:0 0 7px #f97316}
.live-right-column{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:5px;min-width:0;min-height:0}
.live-call-strip{display:grid;grid-template-columns:1fr 1fr;min-height:64px;gap:3px;padding:5px;border-radius:12px;background:#160c25}
.live-current-call{border:0;padding:0}.live-current-call strong{display:grid;place-items:center;width:44px;height:44px;border:2px solid #ffd35b;border-radius:50%;background:radial-gradient(circle at 35% 25%,#29dca0,#087b61 70%);color:#fff;font-size:15px;box-shadow:0 0 12px #f8d36f99,0 0 17px #00c99255}
.live-recent-calls{display:grid;justify-items:center;align-content:center;gap:3px}.live-recent-calls>small{font-size:7px}.live-recent-calls .recent-ball{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#793bd0;color:#fff;font-size:9px;font-weight:900;box-shadow:0 0 10px #9d61ff70}
.live-controls{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.auto-toggle,.sound-toggle{display:flex;align-items:center;justify-content:center;gap:8px;min-height:31px;border:1px solid #302044;border-radius:18px;background:#160d24;color:#e6d9f4;font-size:10px;font-weight:800}
.auto-toggle i{position:relative;width:34px;height:18px;border-radius:20px;background:#46364f;transition:background .15s}.auto-toggle i b{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#c5b8d0;transition:transform .15s}.auto-toggle.enabled i{background:#c7a12d}.auto-toggle.enabled i b{transform:translateX(16px);background:#fff}
.sound-toggle.enabled{border-color:#517354;background:#14392c;color:#bff5d6}
.cartelas-stack{display:flex;min-height:0;flex-direction:column;gap:5px;overflow:hidden}
.live-cartela-card{display:flex;min-height:0;flex:1;flex-direction:column;gap:3px;padding:3px;border:1px solid #28174d;border-radius:11px;background:#160c2e}
.mini-card-title{display:flex;align-items:center;justify-content:center;gap:8px;min-height:14px;color:#d4b34e;font-size:10px;font-weight:900}
.mini-card-title small{color:#887998;font-size:6px;font-weight:750}
.live-cartela-card .player-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(6,minmax(0,1fr));gap:2px;flex:1;min-height:0}
.live-cartela-card .player-grid>b{border-radius:3px;background:transparent;color:#d0ac44;font-size:8px}
.live-cartela-card .player-grid>span{border-color:#392653;border-radius:4px;background:#21153b;color:#fff;font-size:clamp(7px,2.5vw,11px)}
.live-cartela-card .player-grid>span.marked{border-color:#12bd80;background:#10b981;color:#fff}.live-cartela-card .player-grid>span.free{color:#000}
.live-cartela-card .player-grid>span.winning-cell{border-color:#ffd75b;background:#f59e0b;color:#120b17}
.live-cartela-card{flex:0 0 auto;overflow:hidden}
.cartelas-stack{justify-content:space-around;overflow-y:auto;scrollbar-width:none}
.cartelas-stack::-webkit-scrollbar{display:none}
.live-cartela-card .player-grid{grid-template-rows:10px repeat(5,auto);align-content:start;flex:none;width:min(100%,max(68px,calc(41.67dvh - 196px)));margin:0 auto}
.live-cartela-card .player-grid>b{min-height:10px;padding:0}
.live-cartela-card .cartela-cell{display:grid;place-items:center;width:100%;min-width:0;min-height:0;aspect-ratio:1;padding:0;border:1px solid #392653;border-radius:4px;background:#21153b;color:#fff;font-size:clamp(7px,2.5vw,11px);font-weight:850;line-height:1;appearance:none;-webkit-appearance:none;cursor:pointer;user-select:none;transition:background .15s ease,transform .08s ease}
.live-cartela-card .cartela-cell:active{transform:scale(.92)}
.live-cartela-card .cartela-cell.marked{border-color:#12bd80;background:#10b981;color:#fff}
.live-cartela-card .cartela-cell.free{background:#10b981;color:#000}
.live-cartela-card .cartela-cell.win-cell{border-color:#ffd75b;background:#f59e0b;color:#120b17}
.live-cartela-card .cartela-cell:disabled{cursor:default;opacity:1}
.live-cartela-card .cartela-cell.invalid-click{animation:shake .3s ease;border-color:#ef4444;background:#7f1d1d}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.live-spectator-card{display:grid;align-content:center;justify-items:center;flex:1;gap:7px;border:1px solid #342451;border-radius:10px;background:#160c2e;text-align:center}.live-spectator-card>span{font-size:22px}.live-spectator-card>strong{font-size:11px}.live-spectator-card>small{padding:0 8px;color:#aa9bbd;font-size:8px}
.btn-bingo{width:100%;min-height:42px;border:1px solid #392d51;border-radius:12px;background:#1c142e;color:#55466d;font-size:14px;font-weight:950;cursor:not-allowed;transition:all .2s}
.btn-bingo.active-yellow{border-color:#f7c633;background:linear-gradient(90deg,#f59e0b,#eab308);color:#000;cursor:pointer;box-shadow:0 0 14px #f59e0b99;animation:pulse-glow 1.2s infinite alternate}
.btn-bingo:disabled{opacity:1}
.btn-bingo-action{pointer-events:auto}.btn-bingo-action>*{pointer-events:none}.btn-bingo-action.active-yellow{cursor:pointer}
.live-game-footer{display:grid;grid-template-columns:1fr 1fr;gap:7px;min-height:48px;padding:7px 5px calc(4px + env(safe-area-inset-bottom));border-top:1px solid #28174a;background:#120923}
.live-game-footer button{min-height:34px;border:1px solid #312143;border-radius:12px;font-size:9px;font-weight:850}
.live-game-footer .footer-leave{background:#46132b;color:#e4acbd}.live-game-footer .footer-refresh{background:#24215a;color:#c1c9ff}
@keyframes pulse-glow{to{box-shadow:0 0 22px #f59e0bcc;filter:brightness(1.12)}}
.winner-celebration{display:grid;align-content:center;justify-items:center;gap:8px;width:min(100%,430px);height:100dvh;min-height:100dvh;margin:0 auto;padding:calc(14px + env(safe-area-inset-top)) 18px calc(12px + env(safe-area-inset-bottom));overflow:hidden;border:1px solid #e3b938;border-radius:24px;background:#211033;box-shadow:0 0 35px #edbe3570;text-align:center}
.winner-app-shell{width:100%;height:100dvh;min-height:100dvh;overflow:hidden;padding:0;background:#0f0920}
.winner-app-shell>.content{height:100%;overflow:hidden;padding:0}
.winner-app-shell .winner-celebration{height:100%;min-height:0}
.winner-glow{position:absolute;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 50% 47%,#f8ba2415 0,transparent 60%)}
.winner-celebration>*:not(.winner-glow){z-index:1}.winner-celebration .winner-trophy{font-size:36px}.winner-celebration h1{font-size:30px}.winner-subtitle{font-size:12px}
.winner-pot{color:#f6c62e;font-size:14px;font-weight:900;text-shadow:0 0 12px #f6c62e55}
.winner-list{max-height:18dvh;overflow:auto;scrollbar-width:thin}
.winner-list>div{grid-template-columns:1fr auto;align-items:center;padding:7px 10px;border-color:#48335d;background:#2a1b3d}
.winner-list>div>b{color:#f7f0ff;font-size:11px;text-align:left}.winner-list>div>span{padding:4px 6px;border-radius:7px;background:#170d2c;color:#e7c64f;font-size:9px;font-weight:900}
.winner-card-section{width:100%;max-width:320px;padding:7px;background:#10081d}
.winner-card-title{margin-bottom:5px;font-size:8px}
.winner-player-grid{grid-template-rows:repeat(6,minmax(30px,1fr));gap:3px}
.winner-player-grid>b{font-size:9px}.winner-player-grid>span{min-height:30px;font-size:10px}
.winner-player-grid>span.marked{border-color:#15bd7e;background:#10b981;color:#fff}.winner-player-grid>span.free{background:#10b981;color:#000}.winner-player-grid>span.winning-cell{background:#f59e0b!important;color:#000!important;box-shadow:0 0 9px #f59e0b99}
.winner-verified{color:#50e6a7;font-size:10px;font-weight:850}.winner-countdown{margin:0;color:#a99bb8;font-size:10px}
@media(max-height:680px){.game-app-shell .live-game{gap:4px}.live-game-header{min-height:29px}.live-game-hud{padding:4px 6px}.live-play-arena{gap:5px}.live-call-strip{min-height:50px}.live-current-call strong{width:37px;height:37px;font-size:12px}.live-recent-calls .recent-ball{width:29px;height:29px}.live-controls{gap:3px}.auto-toggle,.sound-toggle{min-height:26px}.live-game-footer{min-height:40px;padding-top:4px}.live-game-footer button{min-height:29px}.winner-celebration{gap:5px}.winner-card-section{padding:5px}.winner-player-grid{grid-template-rows:repeat(6,minmax(25px,1fr))}.winner-player-grid>span{min-height:25px}.winner-list{max-height:14dvh}}
@media(max-width:350px){.live-play-arena{grid-template-columns:minmax(0,.68fr) minmax(0,1.32fr);gap:4px}.live-game-hud{gap:3px;padding-right:4px;padding-left:4px}.live-game-hud small{font-size:7px}.live-game-hud b{font-size:9px}.master-cell{font-size:7px}.live-cartela-card{padding:2px}.mini-card-title{font-size:8px}}
.play-screen .room-list{grid-template-columns:minmax(0,1fr);gap:12px}
.play-screen .stake-entry-card{display:grid;gap:14px;margin:0 4px;padding:16px;border:1px solid #8b641d;border-radius:18px;background:#140a28;box-shadow:none}
.stake-header-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;margin:0}
.stake-icon-badge{width:52px;height:52px;border:1px solid #f59e0b;border-radius:14px;background:#231242;font-size:24px}
.stake-info-text{gap:3px}
.stake-info-text h3{overflow:visible!important;color:#fff!important;font-size:18px!important;font-weight:800;white-space:nowrap}
.stake-info-text h3 span{color:#f59e0b}
.stake-info-text small{color:#a99bc2;font-size:11px;white-space:normal}
.btn-enter-game{display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;min-height:44px;padding:10px 15px;border-radius:22px;background:#facc32;color:#090510;font-size:14px;font-weight:850;box-shadow:0 0 12px #f59e0b66;white-space:nowrap}
.btn-enter-game>span{font-size:14px}
.stake-metrics-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0}
.stake-metrics-row .metric-box{display:grid;min-width:0;min-height:76px;align-content:center;justify-items:center;gap:4px;padding:8px 4px;border:1px solid #2b1850;border-radius:12px;background:#1b0d36;text-align:center}
.stake-metrics-row .metric-value{display:flex;align-items:center;justify-content:center;gap:4px;color:#f6f0ff;font-size:13px;font-weight:800;line-height:1.2;white-space:nowrap}
.stake-metrics-row .metric-label{margin:0;color:#9d8dbd;font-size:9px;font-weight:700;letter-spacing:.03em;line-height:1.2}
.stake-metrics-row .room-status-selecting{color:#f4c54f}
.stake-metrics-row .room-status-playing{color:#82b8ff}
.play-screen .play-smart-pill{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:76px;margin:0;padding:12px;border:1px solid #392451;border-radius:14px;background:#1b0d36}
.play-smart-pill h2{margin:0 0 4px;color:#facc15;font-size:13px}
.play-smart-pill p{margin:0;color:#b9aacc;font-size:11px;line-height:1.4}
.play-smart-pill>span{font-size:24px}
@media(max-width:370px){.play-screen .stake-entry-card{gap:10px;margin:0 2px;padding:12px}.stake-header-row{gap:7px}.stake-icon-badge{width:42px;height:42px;font-size:20px}.stake-info-text h3{font-size:15px!important}.stake-info-text small{font-size:9px}.btn-enter-game{min-height:38px;padding:8px 10px;font-size:11px}.stake-metrics-row{gap:5px}.stake-metrics-row .metric-box{min-height:66px}.stake-metrics-row .metric-value{font-size:11px}.stake-metrics-row .metric-label{font-size:7px}.play-screen .play-smart-pill{min-height:64px;padding:9px}.play-smart-pill h2{font-size:11px}.play-smart-pill p{font-size:9px}}
`;

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
