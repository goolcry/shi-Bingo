import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
const telegramWebApp = () => window.Telegram?.WebApp;

const words = {
  en: {
    play: 'Play', ranks: 'Ranks', history: 'History', profile: 'Profile', settings: 'Settings', welcome: 'Play. Win. Enjoy!',
    balance: 'Balance', refresh: 'Refresh', rooms: 'Available room', roomEmpty: 'No waiting rooms are open right now.',
    retry: 'Retry', join: 'JOIN +', cards: 'Select cartelas', available: 'Available', selected: 'Yours',
    taken: 'Taken', count: 'Selected', stake: 'Cost per cartela', total: 'Total', selectHelp: 'Choose up to two cartelas. Funds are charged only after the server confirms your selection.',
    back: 'Back', game: 'Bingo game', recent: 'Recent calls', callBoard: 'Number board', leave: 'Leave room',
    noHistory: 'No game history yet.', noRanks: 'Rankings will appear after completed games.',
    deposit: 'Deposit', withdraw: 'Withdraw', share: 'Share invite', copy: 'Copy invite link',
    support: 'Support', language: 'Language', unavailable: 'Unavailable', loading: 'Loading…',
    rules: 'One Line or Four Corners. FREE center is marked automatically.',
    roomsUnavailable: 'Could not load rooms.', dataUnavailable: 'Could not load this data.',
  },
  am: {
    play: 'ጨዋታ', ranks: 'ደረጃ', history: 'ታሪክ', profile: 'መገለጫ', settings: 'ቅንብሮች', welcome: 'ይጫወቱ። ያሸንፉ። ይደሰቱ!',
    balance: 'ቀሪ ሂሳብ', refresh: 'አድስ', rooms: 'ያሉ ክፍሎች', roomEmpty: 'አሁን የሚጠባበቅ ክፍል የለም።',
    retry: 'እንደገና ሞክር', join: 'ወደ ክፍል ግባ', cards: 'ካርቴላ ይምረጡ', available: 'ያለ', selected: 'የእርስዎ', taken: 'ተይዟል',
    count: 'የተመረጡ', stake: 'የአንድ ካርቴላ ዋጋ', total: 'ጠቅላላ', selectHelp: 'እስከ ሁለት ካርቴላ ይምረጡ። አገልጋዩ ካረጋገጠ በኋላ ብቻ ገንዘብ ይቆረጣል።',
    back: 'ተመለስ', game: 'የቢንጎ ጨዋታ', recent: 'የቅርብ ጥሪዎች', callBoard: 'ቁጥር ሰሌዳ', leave: 'ከክፍሉ ውጣ',
    noHistory: 'ገና የጨዋታ ታሪክ የለም።', noRanks: 'ጨዋታዎች ሲጠናቀቁ ደረጃዎች ይታያሉ።',
    deposit: 'ገንዘብ አስገባ', withdraw: 'ገንዘብ አውጣ', share: 'ግብዣ አጋራ', copy: 'የግብዣ አገናኝ ቅዳ',
    support: 'ድጋፍ', language: 'ቋንቋ', unavailable: 'አልተገኘም', loading: 'በመጫን ላይ…',
    rules: 'አንድ መስመር ወይም አራት ማዕዘኖች። የመሃል FREE ቦታ በራስ-ሰር ይምረጣል።',
    roomsUnavailable: 'ክፍሎችን መጫን አልተቻለም።', dataUnavailable: 'መረጃውን መጫን አልተቻለም።',
  },
};

async function api(path, { method = 'GET', body, initData, allowAnonymous = false } = {}) {
  if (!initData && !allowAnonymous) throw new Error('Open this Mini App from Telegram to authenticate.');
  const response = await fetch(path, {
    method,
    headers: {
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function App() {
  const [lang, setLang] = useState('en');
  const t = words[lang];
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [view, setView] = useState('play');
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
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
    const data = await request('/api/me');
    setUser(data.user);
    setWallet(data.wallet.balance);
    setLang(data.user.language === 'am' ? 'am' : 'en');
  }, [request]);

  const refreshRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const data = await api('/api/rooms', { initData, allowAnonymous: true });
      setRooms(data.rooms);
      return data;
    } finally {
      setRoomsLoading(false);
    }
  }, [initData]);

  const loadRoom = useCallback(async (id) => {
    const data = await request(`/api/rooms/${encodeURIComponent(id)}`);
    setRoom(data.room);
    setGame(data.game || null);
    setView(data.room.status === 'PLAYING' ? 'game' : 'cartelas');
  }, [request]);

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
        if (view === 'game' || view === 'cartelas') {
          setView('play');
          setRoom(null);
          setGame(null);
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
          if (roomData.myRoom) {
            loadRoom(roomData.myRoom).catch((reason) => { if (active) setError(reason.message); });
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
      refreshRooms().catch((reason) => setError(reason.message));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [initData, view, refreshRooms]);

  useEffect(() => {
    if (!room?.id || !['cartelas', 'game'].includes(view)) return undefined;
    let active = true;
    const update = async () => {
      try {
        const data = await request(`/api/rooms/${encodeURIComponent(room.id)}`);
        if (!active) return;
        setRoom(data.room);
        setGame(data.game || null);
        setWallet(data.wallet?.availableBalance ?? wallet);
        if (data.room.status === 'PLAYING') setView('game');
        if (data.room.status === 'FINISHED') setView('winner');
      } catch (reason) {
        if (active) setError(reason.message);
      }
    };
    update();
    const timer = window.setInterval(update, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [room?.id, view, request]);

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

  async function enterRoom(item) {
    setBusy(true);
    try {
      await request(`/api/rooms/${encodeURIComponent(item.id)}/join`, { method: 'POST', body: {} });
      await loadRoom(item.id);
      setError('');
    } catch (reason) {
      try {
        await refreshRooms();
        setError(reason.message);
      } catch (refreshError) {
        setError(`${reason.message} Room refresh failed: ${refreshError.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleCard(card) {
    if (!room || busy || card.state === 'TAKEN') return;
    setBusy(true);
    try {
      const action = card.state === 'MINE' ? 'deselect' : 'select';
      const data = await request(`/api/rooms/${encodeURIComponent(room.id)}/cartelas/${card.number}/${action}`, {
        method: 'POST',
        body: {},
      });
      setRoom(data.room);
      setWallet(data.wallet.availableBalance);
      setError('');
    } catch (reason) {
      setError(reason.message);
      if (room?.id) await loadRoom(room.id).catch(() => {});
      await refreshWallet().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    if (!room || busy) return;
    setBusy(true);
    try {
      await request(`/api/rooms/${encodeURIComponent(room.id)}/leave`, { method: 'POST', body: {} });
      setRoom(null);
      setGame(null);
      setView('play');
      await Promise.all([refreshWallet(), refreshRooms()]);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLanguage(value) {
    setBusy(true);
    try {
      await request('/api/language', { method: 'POST', body: { language: value } });
      setLang(value);
      setError('');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }

  }

  const gameNumbers = game?.calledNumbers || [];
  const calledSet = useMemo(() => new Set(gameNumbers.map(Number)), [gameNumbers]);

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-mark">
        <span className="brand-icon" aria-hidden="true">👑</span>
        <span className="brand-copy"><b>SHISHO BINGO</b><small>{user?.firstName || (telegramChecked ? 'Player' : t.loading)}</small></span>
      </div>
      <button className="wallet-chip" onClick={() => go('wallet')} aria-label={t.balance}>
        <span aria-hidden="true">💰</span> {wallet === null ? '—' : money(wallet)} <small>ETB</small>
      </button>
    </header>

    {error && <div className="alert" role="alert"><span>{error}</span>
      {error.toLowerCase().includes('insufficient balance') && <button onClick={() => go('wallet')}>{t.deposit}</button>}
      <button onClick={() => {
        if (!initData) {
          retryTelegramAuthentication();
          return;
        }
        setError('');
        Promise.all([refreshWallet(), refreshRooms()]).catch((reason) => setError(reason.message));
      }}>{t.retry}</button>
    </div>}

    <main className="content">
      {view === 'play' && <PlayScreen t={t} rooms={rooms} roomsLoading={roomsLoading} onJoin={enterRoom} busy={busy} onRefresh={() => refreshRooms().catch((reason) => setError(reason.message))} />}
      {view === 'cartelas' && room && <CartelaScreen room={room} t={t} busy={busy} wallet={wallet} onToggle={toggleCard} onBack={leaveRoom} />}
      {view === 'game' && room && <GameScreen room={room} game={game} t={t} calledSet={calledSet} busy={busy} onLeave={leaveRoom} onRefresh={() => loadRoom(room.id)} onBingo={async (number) => {
        setBusy(true);
        try { await request(`/api/rooms/${room.id}/bingo`, { method: 'POST', body: { cartelaNumber: number } }); await loadRoom(room.id); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
      }} />}
      {view === 'winner' && <WinnerScreen game={game} room={room} t={t} onBack={() => go('play')} />}
      {view === 'ranks' && <RanksScreen ranks={ranks} t={t} userId={user?.id} />}
      {view === 'history' && <HistoryScreen history={history} t={t} />}
      {view === 'profile' && <ProfileScreen profile={profile} user={user} wallet={wallet} t={t} onLanguage={saveLanguage} busy={busy} referral={referral} appInfo={appInfo} onRanks={() => go('ranks')} onRefresh={() => refreshWallet().catch((reason) => setError(reason.message))} />}
      {view === 'wallet' && <WalletScreen wallet={wallet} t={t} onRefresh={() => Promise.all([refreshWallet(), request('/api/history')]).catch((reason) => setError(reason.message))} onError={setError} />}
    </main>

    {!['cartelas', 'game', 'winner'].includes(view) && <nav className="bottom-nav">
      {[
        ['play', '🎮', t.play], ['ranks', '🏆', t.ranks], ['history', '📜', t.history], ['profile', '👤', t.profile],
      ].map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => go(id)}>
        <span>{icon}</span>{label}
      </button>)}
    </nav>}
    <style>{styles}</style>
  </div>;
}

function PlayScreen({ t, rooms, roomsLoading, onJoin, busy, onRefresh }) {
  return <div className="play-screen">
    <section className="hero">
      <div className="hero-crown" aria-hidden="true">👑</div>
      <h1>SHISHO <b>BINGO</b></h1>
      <p>{t.welcome}</p>
      <div className="features">
        <span>🏆 REAL-TIME</span><span>🎟️ MULTIPLE ROOMS</span><span>💰 INSTANT REWARDS</span>
      </div>
    </section>
    <section className="section-heading"><h2 className="eyebrow">{t.rooms}</h2></section>
    {roomsLoading && rooms.length === 0
      ? <div className="empty panel" role="status"><span className="empty-icon">🎱</span><strong>{t.loading}</strong></div>
      : rooms.length === 0
      ? <div className="empty panel"><span className="empty-icon">🎱</span><strong>{t.roomEmpty}</strong><p>New rooms will appear here when opened.</p><button className="outline-button" onClick={onRefresh}>↻ {t.retry}</button></div>
      : <div className="room-list">{rooms.map((room) => <article className="room-card panel" key={room.id}>
        <div className="room-title">
          <span className="room-emblem" aria-hidden="true">⑧</span>
          <div className="room-description"><h3>Room #{room.roomNumber || room.id}</h3><small>75-Ball Classic · Max {room.maxPlayers} Players</small></div>
          <button className="join-button" disabled={busy || room.status !== 'WAITING' || room.currentPlayers >= room.maxPlayers} onClick={() => onJoin(room)}>
            {busy ? t.loading : 'JOIN +'}
          </button>
        </div>
        <div className="room-stats">
          <div><b>{money(room.prizePool)}</b><small>POT BIRR</small></div>
          <div><b>{room.currentPlayers}/{room.maxPlayers}</b><small>PLAYERS</small></div>
          <div><b>{room.status}</b><small>STATUS</small></div>
        </div>
      </article>)}</div>}
    <section className="play-smart panel">
      <div><h2>🎁 PLAY SMART</h2><p>Choose up to 2 cartelas. Each cartela costs 10 BIRR.</p></div>
      <span aria-hidden="true">🎟️</span>
    </section>
    <section className="how-to">
      <h2 className="eyebrow">HOW TO PLAY</h2>
      <div className="how-to-card panel">
        <div><b>1</b><span>Pick a room</span></div>
        <div><b>2</b><span>Choose cards</span></div>
        <div><b>3</b><span>Auto-mark &amp; win</span></div>
      </div>
    </section>
  </div>;
}

function CartelaScreen({ room, t, busy, wallet, onToggle, onBack }) {
  const cards = room.cartelas || [];
  const mine = cards.filter((card) => card.state === 'MINE');
  return <>
    <button className="text-button" onClick={onBack}>← {t.back}</button>
    <section className="section-heading"><div><div className="eyebrow">ROOM #{room.roomNumber || room.id}</div><h2>{t.cards}</h2></div><span className="status status-waiting">{room.status}</span></section>
    <div className="panel cartela-summary">
      <div><small>{t.available}</small><b>{cards.filter((card) => card.state === 'AVAILABLE').length}/100</b></div>
      <div><small>{t.count}</small><b>{mine.length}/2</b></div>
      <div><small>{t.stake}</small><b>{money(room.stake)} BIRR</b></div>
      <div><small>{t.balance}</small><b>{wallet === null ? t.unavailable : `${money(wallet)} BIRR`}</b></div>
    </div>
    <p className="muted">{t.selectHelp}</p>
    <div className="legend"><span><i className="available-dot" />{t.available}</span><span><i className="mine-dot" />{t.selected}</span><span><i className="taken-dot" />{t.taken}</span></div>
    <div className="cartela-grid">{cards.map((card) => <button
      key={card.number}
      className={`cartela cartela-${String(card.state).toLowerCase()} ${busy ? 'processing' : ''}`}
      disabled={busy || card.state === 'TAKEN'}
      aria-label={`Cartela ${card.number}: ${card.state}`}
      onClick={() => onToggle(card)}
    >{card.number}</button>)}</div>
    <div className="sticky-summary panel">
      <div><small>{t.selected}: {mine.map((card) => `#${card.number}`).join(', ') || '—'} · {mine.length}/2</small>
        <b>{t.total}: {money(room.selection?.totalCost ?? multiplyMoney(room.stake, mine.length).toString())} BIRR</b>
      </div>
      <span className="muted">Remaining · {room.selection?.remainingBalance == null ? (wallet === null ? '—' : money(wallet)) : money(room.selection.remainingBalance)} BIRR</span>
    </div>
  </>;
}

function GameScreen({ room, game, t, calledSet, busy, onLeave, onRefresh, onBingo }) {
  const [selected, setSelected] = useState(0);
  const myCards = room.cartelas?.filter((card) => card.state === 'MINE') || [];
  const activeCard = myCards[selected];
  const recent = (game?.calledNumbers || []).slice(-5).reverse();
  const columns = [1, 16, 31, 46, 61];
  return <>
    <section className="game-head">
      <div><div className="eyebrow">SHISHO BINGO · ROOM #{room.roomNumber || room.id}</div><h2>{t.game}</h2></div>
      <span className="status status-playing">{room.status}</span>
    </section>
    <div className="game-stats panel">
      <div><small>POT</small><b>{money(room.prizePool)} BIRR</b></div>
      <div><small>PLAYERS</small><b>{room.currentPlayers}</b></div>
      <div><small>STAKE</small><b>{money(room.stake)}</b></div>
      <div><small>CALL</small><b>{game?.calledNumbers?.length || 0}</b></div>
    </div>
    <div className="last-number panel"><small>LAST NUMBER</small><strong>{game?.calledNumbers?.length ? bingoLabel(game.calledNumbers.at(-1)) : '—'}</strong><div className="recent">{recent.map((number) => <span key={number}>{bingoLabel(number)}</span>)}</div></div>
    <section className="section-heading"><h2>{t.callBoard}</h2><button className="outline-button" onClick={onRefresh}>↻ {t.refresh}</button></section>
    <div className="bingo-board panel">
      {['B', 'I', 'N', 'G', 'O'].map((letter, col) => <div className="bingo-column" key={letter}>
        <div className={`bingo-letter letter-${letter}`}>{letter}</div>
        {Array.from({ length: 15 }, (_, row) => columns[col] + row).map((number) =>
          <span className={`bingo-cell ${calledSet.has(number) ? 'called' : ''} ${game?.calledNumbers?.at(-1) === number ? 'latest' : ''}`} key={number}>{number}</span>)}
      </div>)}
    </div>
    {myCards.length > 1 && <div className="card-switch">{myCards.map((card, index) => <button className={selected === index ? 'selected' : ''} key={card.number} onClick={() => setSelected(index)}>Cartela #{card.number}</button>)}</div>}
    {activeCard && <section className="panel player-card"><div className="section-heading"><h2>My Cartela #{activeCard.number}</h2><span>{activeCard.progress || 0}%</span></div><CardNumbers numbers={activeCard.numbers} calledSet={calledSet} /></section>}
    <p className="muted">{t.rules}</p>
    {activeCard && <button disabled={busy} className="primary-button" onClick={() => onBingo(activeCard.number)}>🎉 BINGO!</button>}
    <button disabled={busy} className="danger-button" onClick={onLeave}>{t.leave}</button>
  </>;
}

function CardNumbers({ numbers, calledSet }) {
  const values = numbers || [];
  return <div className="player-grid">
    {['B', 'I', 'N', 'G', 'O'].map((letter) => <b key={`h-${letter}`}>{letter}</b>)}
    {values.map((value, index) => <span key={index} className={`${value === 'FREE' ? 'free' : ''} ${calledSet.has(Number(value)) ? 'marked' : ''}`}>{value === 'FREE' ? '★' : value}</span>)}
  </div>;
}

function bingoLabel(number) {
  const n = Number(number);
  return `${n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O'}-${n}`;
}

function WinnerScreen({ game, room, t, onBack }) {
  return <section className="winner panel">
    <div className="winner-crown">♛</div><div className="eyebrow">SHISHO BINGO</div><h1>{game?.winners?.length ? 'BINGO!' : 'GAME OVER'}</h1>
    <p>{game?.winners?.length ? 'We have a winner!' : 'The game ended without a winning cartela.'}</p>
    {(game?.winners || []).map((winner) => <div className="winner-row" key={`${winner.userId}-${winner.cartelaNumber}`}>
      <strong>{winner.displayName}</strong><span>Cartela #{winner.cartelaNumber} · {winner.pattern}</span><b>{money(winner.prize)} BIRR</b>
    </div>)}
    {!game?.winners?.length && <p className="muted">Winner results are being loaded from the game service.</p>}
    <p className="muted">Room #{room?.roomNumber || room?.id}</p><button className="primary-button" onClick={onBack}>Back to rooms</button>
  </section>;
}

function RanksScreen({ ranks, t, userId }) {
  return <><div className="eyebrow">SHISHO BINGO</div><h1 className="page-title">🏆 {t.ranks}</h1>
    {ranks.length ? <div className="panel rank-list">{ranks.map((rank, i) => <div className="rank-row" key={rank.userId || i}>
      <span className="rank-position">{rank.rank || i + 1}</span><strong>{rank.displayName}{rank.userId === userId ? ' (You)' : ''}</strong><span>{rank.gamesWon} wins</span><b>{money(rank.winnings)} BIRR</b>
    </div>)}</div> : <div className="empty panel"><span className="empty-icon">👑</span><strong>{t.noRanks}</strong></div>}
  </>;
}

function HistoryScreen({ history, t }) {
  return <><div className="eyebrow">SHISHO BINGO</div><h1 className="page-title">📜 {t.history}</h1>
    {history.length ? <div className="history-list">{history.map((item, index) => <article className="panel history-item" key={item.id || index}>
      <div className="row"><strong>{item.roomId ? `Room #${item.roomId}` : item.type}</strong><span className="status">{item.result || item.status || item.type}</span></div>
      <p>{item.cartelas ? `Cartelas: ${item.cartelas.join(', ')} · Stake: ${money(item.stake)} BIRR${item.pattern ? ` · Pattern: ${item.pattern}` : ''}` : item.description}</p>
      <div className="row muted"><span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</span><b>{item.prize ? `${money(item.prize)} BIRR` : item.amount ? `${money(item.amount)} BIRR` : ''}</b></div>
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
        setRoomMessage('Invite link copied.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') setRoomMessage(error.message);
    }
  }
  return <><div className="eyebrow">PLAYER PROFILE</div><h1 className="page-title">👤 {t.profile}</h1>
    <section className="profile-card panel"><div className="avatar">{(info?.firstName || 'S').slice(0, 1).toUpperCase()}</div>
      <h2>{[info?.firstName, info?.lastName].filter(Boolean).join(' ') || t.loading}</h2><p className="muted">{info?.username ? `@${info.username} · ` : ''}ID {info?.id || '—'}</p>
      <div className="profile-stats">
        <Stat label={t.balance} value={wallet === null ? t.unavailable : `${money(wallet)} BIRR`} />
        <Stat label="Games won" value={profile?.games?.won ?? '—'} />
        <Stat label="Winnings" value={profile?.games?.winnings ? `${money(profile.games.winnings)} BIRR` : '—'} />
        <Stat label="Win rate" value={`${profile?.games?.winRate ?? '—'}%`} />
        <Stat label="Referrals" value={profile?.referrals?.successful ?? '—'} />
      </div>
      <button disabled={busy} className="outline-button" onClick={onRefresh}>↻ {t.refresh}</button>
    </section>
    <section className="panel settings"><h2>Settings</h2><div className="row"><span>{t.language}</span>
      <div className="language-control"><button className={profile?.user?.language === 'en' ? 'selected' : ''} onClick={() => onLanguage('en')}>🇬🇧 English</button><button className={profile?.user?.language === 'am' ? 'selected' : ''} onClick={() => onLanguage('am')}>🇪🇹 አማርኛ</button></div>
    </div><div className="row"><span>Rules</span><span className="muted">{t.rules}</span></div>
      <button className="outline-button" onClick={onRanks}>🏆 {t.ranks}</button>
    </section>
    <section className="panel settings"><h2>{t.share}</h2>
      <p className="muted">{referral?.referralUrl || t.loading}</p>
      <div className="row">
        <button className="outline-button" onClick={shareInvite} disabled={!referral?.referralUrl}>{t.copy} / Share</button>
        <button className="outline-button" onClick={() => appInfo?.supportUrl && telegramWebApp()?.openTelegramLink(appInfo.supportUrl)} disabled={!appInfo?.supportUrl}>{t.support}</button>
      </div>
      <p className="muted">Successful referrals: {referral?.successful ?? '—'}</p>
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
      setStatus(`Deposit request #${data.request.id} submitted; admin approval is required.`);
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
          idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
        },
      });
      setWithdrawStatus(`Withdrawal request #${data.request.id} submitted for admin review.`);
      setWithdrawAmount('');
      setPayoutDetails('');
      await onRefresh();
    } catch (error) {
      setWithdrawStatus(error.message);
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <><div className="eyebrow">SHARED WALLET</div><h1 className="page-title">💰 {t.balance}</h1>
    <section className="panel wallet-panel"><small>Available balance</small><strong>{wallet === null ? t.unavailable : `${money(wallet)} BIRR`}</strong><button className="outline-button" onClick={() => onRefresh().catch((error) => onError(error.message))}>↻ {t.refresh}</button></section>
    <section className="panel wallet-panel"><h2>{t.deposit}</h2>{methods.length ? <form onSubmit={submit}>
      <label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}>{methods.map((item) => <option key={item.method} value={item.method}>{item.label}</option>)}</select></label>
      {current && <p className="payment-details">{current.label} · {current.accountName} · {current.account}</p>}
      <label>Amount (BIRR)<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Transaction reference<input required maxLength="128" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <button className="primary-button" disabled={busy}>{busy ? t.loading : 'Submit for approval'}</button>
      {status && <p className="muted">{status}</p>}
    </form> : <p className="muted">{status || 'Payment methods are not configured.'}</p>}</section>
    <section className="panel wallet-panel"><h2>{t.withdraw}</h2>
      <p className="muted">Minimum withdrawal: 50.00 BIRR. Requests reserve funds while an administrator reviews the payout.</p>
      <form onSubmit={submitWithdrawal}>
        <label>Amount (BIRR)<input required inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} /></label>
        <label>Payment method<select value={withdrawMethod} onChange={(event) => setWithdrawMethod(event.target.value)}><option value="TELEBIRR">Telebirr</option><option value="CBE">CBE</option></select></label>
        <label>Phone/account details<input required minLength="5" maxLength="191" value={payoutDetails} onChange={(event) => setPayoutDetails(event.target.value)} /></label>
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
`;

createRoot(document.getElementById('root')).render(<App />);
