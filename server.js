const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ── In-memory store ──
const sessions = new Map();

function createSession(name, moderatorId) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const session = {
    id: uuidv4(),
    code,
    name,
    moderatorId,
    questions: [],
    participants: new Set(),
    createdAt: Date.now(),
    isActive: true,
    settings: {
      allowAnonymous: true,
      maxQuestionLength: 300,
      clusteringEnabled: true
    }
  };
  sessions.set(code, session);
  return session;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) return config.address;
    }
  }
  return 'localhost';
}

// ── Similarity detection ──
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
}

function similarity(a, b) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  return intersection / Math.max(tokensA.size, tokensB.size);
}

function findSimilarQuestions(session, newText) {
  if (!session.settings.clusteringEnabled) return [];
  return session.questions
    .filter(q => !q.isAnswered && !q.isHidden)
    .filter(q => similarity(q.text, newText) > 0.5)
    .map(q => ({ id: q.id, text: q.text, score: similarity(q.text, newText) }))
    .sort((a, b) => b.score - a.score);
}

// ── REST routes ──

app.post('/api/sessions', (req, res) => {
  const { name, moderatorId } = req.body;
  const session = createSession(name || 'AMA Session', moderatorId);
  res.json({ code: session.code, id: session.id, name: session.name });
});

app.get('/api/sessions/:code', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    code: session.code,
    name: session.name,
    isActive: session.isActive,
    questionCount: session.questions.length,
    participantCount: session.participants.size,
    settings: session.settings
  });
});

app.get('/api/sessions/:code/qr', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const ip = getLocalIP();
  const port = process.env.PORT || 3000;
  const url = `http://${ip}:${port}/intern.html?code=${code}`;
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 2, color: { dark: '#1a73e8' } });
  res.json({ qr, url });
});

app.get('/api/sessions/:code/export', (req, res) => {
  const session = sessions.get(req.params.code.toUpperCase());
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const unanswered = session.questions
    .filter(q => !q.isAnswered && !q.isHidden)
    .sort((a, b) => b.votes - a.votes);

  const answered = session.questions
    .filter(q => q.isAnswered)
    .sort((a, b) => b.votes - a.votes);

  res.json({
    session: session.name,
    exportedAt: new Date().toISOString(),
    totalQuestions: session.questions.length,
    totalParticipants: session.participants.size,
    unanswered,
    answered
  });
});

// ── Socket.IO ──
io.on('connection', (socket) => {

  socket.on('join-session', ({ code, userId, userName, role }) => {
    const session = sessions.get(code);
    if (!session) return socket.emit('error', { message: 'Session not found' });

    socket.join(code);
    socket.sessionCode = code;
    socket.userId = userId;
    socket.role = role;

    if (role === 'intern') {
      session.participants.add(userId);
    }

    socket.emit('session-data', {
      name: session.name,
      code: session.code,
      isActive: session.isActive,
      questions: session.questions.filter(q => !q.isHidden),
      participantCount: session.participants.size,
      settings: session.settings
    });

    io.to(code).emit('participant-count', session.participants.size);
  });

  socket.on('submit-question', ({ code, text, userName, isAnonymous, tags }) => {
    const session = sessions.get(code);
    if (!session || !session.isActive) return;

    const similar = findSimilarQuestions(session, text);
    if (similar.length > 0) {
      socket.emit('similar-found', { similar, originalText: text });
      return;
    }

    const question = {
      id: uuidv4(),
      text: text.substring(0, session.settings.maxQuestionLength),
      userName: isAnonymous ? 'Anonymous' : (userName || 'Anonymous'),
      isAnonymous,
      votes: 1,
      voters: [socket.userId],
      tags: tags || [],
      createdAt: Date.now(),
      isAnswered: false,
      isPinned: false,
      isHidden: false,
      clusteredWith: []
    };

    session.questions.push(question);
    io.to(code).emit('new-question', question);
    io.to(code).emit('stats-update', buildStats(session));
  });

  socket.on('force-submit', ({ code, text, userName, isAnonymous, tags }) => {
    const session = sessions.get(code);
    if (!session || !session.isActive) return;

    const question = {
      id: uuidv4(),
      text: text.substring(0, session.settings.maxQuestionLength),
      userName: isAnonymous ? 'Anonymous' : (userName || 'Anonymous'),
      isAnonymous,
      votes: 1,
      voters: [socket.userId],
      tags: tags || [],
      createdAt: Date.now(),
      isAnswered: false,
      isPinned: false,
      isHidden: false,
      clusteredWith: []
    };

    session.questions.push(question);
    io.to(code).emit('new-question', question);
    io.to(code).emit('stats-update', buildStats(session));
  });

  socket.on('vote', ({ code, questionId }) => {
    const session = sessions.get(code);
    if (!session) return;

    const q = session.questions.find(q => q.id === questionId);
    if (!q) return;

    if (q.voters.includes(socket.userId)) {
      q.voters = q.voters.filter(v => v !== socket.userId);
      q.votes--;
    } else {
      q.voters.push(socket.userId);
      q.votes++;
    }

    io.to(code).emit('vote-update', { questionId, votes: q.votes, voters: q.voters });
  });

  socket.on('mark-answered', ({ code, questionId }) => {
    const session = sessions.get(code);
    if (!session) return;
    const q = session.questions.find(q => q.id === questionId);
    if (q) {
      q.isAnswered = !q.isAnswered;
      io.to(code).emit('question-updated', q);
      io.to(code).emit('stats-update', buildStats(session));
    }
  });

  socket.on('pin-question', ({ code, questionId }) => {
    const session = sessions.get(code);
    if (!session) return;
    const q = session.questions.find(q => q.id === questionId);
    if (q) {
      q.isPinned = !q.isPinned;
      io.to(code).emit('question-updated', q);
    }
  });

  socket.on('hide-question', ({ code, questionId }) => {
    const session = sessions.get(code);
    if (!session) return;
    const q = session.questions.find(q => q.id === questionId);
    if (q) {
      q.isHidden = !q.isHidden;
      io.to(code).emit('question-updated', q);
      io.to(code).emit('stats-update', buildStats(session));
    }
  });

  socket.on('toggle-session', ({ code }) => {
    const session = sessions.get(code);
    if (!session) return;
    session.isActive = !session.isActive;
    io.to(code).emit('session-toggled', session.isActive);
  });

  socket.on('update-settings', ({ code, settings }) => {
    const session = sessions.get(code);
    if (!session) return;
    Object.assign(session.settings, settings);
    io.to(code).emit('settings-updated', session.settings);
  });

  socket.on('disconnect', () => {});
});

function buildStats(session) {
  const visible = session.questions.filter(q => !q.isHidden);
  return {
    total: visible.length,
    answered: visible.filter(q => q.isAnswered).length,
    unanswered: visible.filter(q => !q.isAnswered).length,
    participants: session.participants.size,
    totalVotes: visible.reduce((sum, q) => sum + q.votes, 0)
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║           🎤  AskUp is running!          ║`);
  console.log(`  ╠══════════════════════════════════════════╣`);
  console.log(`  ║  Local:   http://localhost:${PORT}          ║`);
  console.log(`  ║  Network: http://${ip}:${PORT}    ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
