import { handle, readJson, send, callClaude, str } from './_lib.js';
import { prospectSystem } from './_prompts.js';

const DEMO_LINES = {
  easy: ['Hello?', 'Oh hi, sure, tell me more.', 'That actually sounds useful. What would the next step be?', 'Sounds good, let\'s do it. [[END:yes]]'],
  medium: ['Hello?', 'I\'m a bit busy, what is this about?', 'We already have something for that. Why would I switch?', 'Okay, send me the details and I\'ll look. [[END:yes]]'],
  hard: ['Yeah?', 'Not interested. Who gave you this number?', 'That\'s what everyone says. Be specific.', 'No thanks. [[END:no]]'],
  extreme: ['What.', 'I don\'t take sales calls.', 'Stop. Don\'t call again. [[END:hangup]]'],
};

export default handle(async (req, res) => {
  const b = await readJson(req);
  const mode = ['easy', 'medium', 'hard', 'extreme'].includes(b.mode) ? b.mode : 'medium';
  const salesType = ['cold_call', 'door_to_door', 'demo_call'].includes(b.sales_type) ? b.sales_type : 'cold_call';
  const history = (Array.isArray(b.history) ? b.history : []).slice(-40).map((m) => ({
    role: m.role === 'rep' ? 'rep' : 'prospect',
    text: str(m.text, 500),
  })).filter((m) => m.text);

  let out;
  let demo = false;
  if (!process.env.ANTHROPIC_API_KEY) {
    demo = true;
    const lines = DEMO_LINES[mode];
    out = lines[Math.min(history.filter((m) => m.role === 'rep').length, lines.length - 1)];
  } else {
    // Anthropic wants alternating roles starting with "user". The call connects first, so we seed a user turn.
    const msgs = [{ role: 'user', content: '[The call connects. You answer.]' }];
    for (const m of history) {
      const role = m.role === 'rep' ? 'user' : 'assistant';
      const last = msgs[msgs.length - 1];
      if (last.role === role) last.content += ' ' + m.text; else msgs.push({ role, content: m.text });
    }
    if (msgs[msgs.length - 1].role === 'assistant') msgs.push({ role: 'user', content: '[The rep is silent.]' });
    out = await callClaude({
      system: prospectSystem({ mode, salesType, category: str(b.category, 60), sells: str(b.sells, 160) }),
      messages: msgs,
      maxTokens: 120,
    });
  }

  const m = out.match(/\[\[END:(yes|no|hangup)\]\]/i);
  const reply = out.replace(/\[\[END:[^\]]*\]\]/gi, '').replace(/\s+/g, ' ').trim() || '...';
  send(res, 200, { reply, end: m ? m[1].toLowerCase() : null, demo });
});
