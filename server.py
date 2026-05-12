import os
import io
import json
import uuid
import base64
import socket
import string
import random
from datetime import datetime

try:
    import eventlet
    eventlet.monkey_patch()
except ImportError:
    pass

from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO, emit, join_room

import qrcode

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['SECRET_KEY'] = 'askup-secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# ── In-memory store ──
sessions = {}


def generate_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def create_session(name, moderator_id):
    code = generate_code()
    while code in sessions:
        code = generate_code()
    session = {
        'id': str(uuid.uuid4()),
        'code': code,
        'name': name,
        'moderatorId': moderator_id,
        'questions': [],
        'participants': set(),
        'createdAt': datetime.now().isoformat(),
        'isActive': True,
        'settings': {
            'allowAnonymous': True,
            'maxQuestionLength': 300,
            'clusteringEnabled': True
        }
    }
    sessions[code] = session
    return session


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def tokenize(text):
    cleaned = ''.join(c if c.isalnum() or c.isspace() else '' for c in text.lower())
    return [w for w in cleaned.split() if len(w) > 2]


def similarity(a, b):
    tokens_a = set(tokenize(a))
    tokens_b = set(tokenize(b))
    if not tokens_a or not tokens_b:
        return 0
    intersection = len(tokens_a & tokens_b)
    return intersection / max(len(tokens_a), len(tokens_b))


def find_similar(session, new_text):
    if not session['settings']['clusteringEnabled']:
        return []
    results = []
    for q in session['questions']:
        if q['isAnswered'] or q['isHidden']:
            continue
        score = similarity(q['text'], new_text)
        if score > 0.5:
            results.append({'id': q['id'], 'text': q['text'], 'score': score})
    results.sort(key=lambda x: x['score'], reverse=True)
    return results


def build_stats(session):
    visible = [q for q in session['questions'] if not q['isHidden']]
    return {
        'total': len(visible),
        'answered': sum(1 for q in visible if q['isAnswered']),
        'unanswered': sum(1 for q in visible if not q['isAnswered']),
        'participants': len(session['participants']),
        'totalVotes': sum(q['votes'] for q in visible)
    }


def session_to_json(session):
    return {
        'code': session['code'],
        'name': session['name'],
        'isActive': session['isActive'],
        'questions': [q for q in session['questions'] if not q['isHidden']],
        'participantCount': len(session['participants']),
        'settings': session['settings']
    }


# ── Routes ──

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('public', path)


@app.route('/api/sessions', methods=['POST'])
def create_session_route():
    data = request.get_json()
    name = data.get('name', 'AMA Session')
    moderator_id = data.get('moderatorId', str(uuid.uuid4()))
    session = create_session(name, moderator_id)
    return jsonify({'code': session['code'], 'id': session['id'], 'name': session['name']})


@app.route('/api/sessions/<code>')
def get_session(code):
    session = sessions.get(code.upper())
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify({
        'code': session['code'],
        'name': session['name'],
        'isActive': session['isActive'],
        'questionCount': len(session['questions']),
        'participantCount': len(session['participants']),
        'settings': session['settings']
    })


@app.route('/api/sessions/<code>/qr')
def get_qr(code):
    code = code.upper()
    session = sessions.get(code)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    ip = get_local_ip()
    port = int(os.environ.get('PORT', 3000))
    url = f'http://{ip}:{port}/intern.html?code={code}'

    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#1a73e8', back_color='white')

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()

    return jsonify({'qr': f'data:image/png;base64,{b64}', 'url': url})


@app.route('/api/sessions/<code>/export')
def export_session(code):
    session = sessions.get(code.upper())
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    unanswered = sorted(
        [q for q in session['questions'] if not q['isAnswered'] and not q['isHidden']],
        key=lambda q: q['votes'], reverse=True
    )
    answered = sorted(
        [q for q in session['questions'] if q['isAnswered']],
        key=lambda q: q['votes'], reverse=True
    )

    return jsonify({
        'session': session['name'],
        'exportedAt': datetime.now().isoformat(),
        'totalQuestions': len(session['questions']),
        'totalParticipants': len(session['participants']),
        'unanswered': unanswered,
        'answered': answered
    })


# ── Socket events ──

@socketio.on('join-session')
def handle_join(data):
    code = data.get('code', '')
    user_id = data.get('userId', '')
    role = data.get('role', 'intern')

    session = sessions.get(code)
    if not session:
        emit('error', {'message': 'Session not found'})
        return

    join_room(code)

    if role == 'intern':
        session['participants'].add(user_id)

    emit('session-data', session_to_json(session))
    emit('participant-count', len(session['participants']), to=code)


@socketio.on('submit-question')
def handle_submit(data):
    code = data.get('code', '')
    text = data.get('text', '').strip()
    session = sessions.get(code)
    if not session or not session['isActive'] or not text:
        return

    similar = find_similar(session, text)
    if similar:
        emit('similar-found', {'similar': similar, 'originalText': text})
        return

    question = {
        'id': str(uuid.uuid4()),
        'text': text[:session['settings']['maxQuestionLength']],
        'userName': 'Anonymous' if data.get('isAnonymous') else (data.get('userName') or 'Anonymous'),
        'isAnonymous': bool(data.get('isAnonymous')),
        'votes': 1,
        'voters': [data.get('userId', '')],
        'tags': data.get('tags', []),
        'createdAt': int(datetime.now().timestamp() * 1000),
        'isAnswered': False,
        'isPinned': False,
        'isHidden': False,
        'clusteredWith': []
    }
    session['questions'].append(question)
    emit('new-question', question, to=code)
    emit('stats-update', build_stats(session), to=code)


@socketio.on('force-submit')
def handle_force_submit(data):
    code = data.get('code', '')
    text = data.get('text', '').strip()
    session = sessions.get(code)
    if not session or not session['isActive'] or not text:
        return

    question = {
        'id': str(uuid.uuid4()),
        'text': text[:session['settings']['maxQuestionLength']],
        'userName': 'Anonymous' if data.get('isAnonymous') else (data.get('userName') or 'Anonymous'),
        'isAnonymous': bool(data.get('isAnonymous')),
        'votes': 1,
        'voters': [data.get('userId', '')],
        'tags': data.get('tags', []),
        'createdAt': int(datetime.now().timestamp() * 1000),
        'isAnswered': False,
        'isPinned': False,
        'isHidden': False,
        'clusteredWith': []
    }
    session['questions'].append(question)
    emit('new-question', question, to=code)
    emit('stats-update', build_stats(session), to=code)


@socketio.on('vote')
def handle_vote(data):
    code = data.get('code', '')
    question_id = data.get('questionId', '')
    session = sessions.get(code)
    if not session:
        return

    q = next((q for q in session['questions'] if q['id'] == question_id), None)
    if not q:
        return

    user_id = request.sid
    if user_id in q['voters']:
        q['voters'].remove(user_id)
        q['votes'] -= 1
    else:
        q['voters'].append(user_id)
        q['votes'] += 1

    emit('vote-update', {'questionId': question_id, 'votes': q['votes'], 'voters': q['voters']}, to=code)


@socketio.on('mark-answered')
def handle_mark_answered(data):
    code = data.get('code', '')
    question_id = data.get('questionId', '')
    session = sessions.get(code)
    if not session:
        return

    q = next((q for q in session['questions'] if q['id'] == question_id), None)
    if q:
        q['isAnswered'] = not q['isAnswered']
        emit('question-updated', q, to=code)
        emit('stats-update', build_stats(session), to=code)


@socketio.on('pin-question')
def handle_pin(data):
    code = data.get('code', '')
    question_id = data.get('questionId', '')
    session = sessions.get(code)
    if not session:
        return

    q = next((q for q in session['questions'] if q['id'] == question_id), None)
    if q:
        q['isPinned'] = not q['isPinned']
        emit('question-updated', q, to=code)


@socketio.on('hide-question')
def handle_hide(data):
    code = data.get('code', '')
    question_id = data.get('questionId', '')
    session = sessions.get(code)
    if not session:
        return

    q = next((q for q in session['questions'] if q['id'] == question_id), None)
    if q:
        q['isHidden'] = not q['isHidden']
        emit('question-updated', q, to=code)
        emit('stats-update', build_stats(session), to=code)


@socketio.on('toggle-session')
def handle_toggle(data):
    code = data.get('code', '')
    session = sessions.get(code)
    if not session:
        return
    session['isActive'] = not session['isActive']
    emit('session-toggled', session['isActive'], to=code)


@socketio.on('update-settings')
def handle_settings(data):
    code = data.get('code', '')
    settings = data.get('settings', {})
    session = sessions.get(code)
    if not session:
        return
    session['settings'].update(settings)
    emit('settings-updated', session['settings'], to=code)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    ip = get_local_ip()
    print(f'\n  +{"=" * 44}+')
    print(f'  |{"AskUp is running!":^44}|')
    print(f'  +{"=" * 44}+')
    print(f'  |  Local:   http://localhost:{port:<14}|')
    print(f'  |  Network: http://{ip}:{port:<14}|')
    print(f'  +{"=" * 44}+\n')
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
