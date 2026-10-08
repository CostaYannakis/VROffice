"""Text to speech for office mods (the massage client, say): POST /api/tts {text, voice, style} speaks a line in one of
Gemini's voices and streams it back as raw 24 kHz mono 16-bit little-endian PCM while it is made. Every finished line is
kept in a disk cache, so a mod can say (or prefetch) the same line again for free and instantly. The spend counts
towards the office's daily voice limit.

POST /api/chat lets you talk to a mod's character: it takes what you said (a short WAV recording, or text), who the
character is and what they remember, and returns what Gemini heard and the character's reply, for the mod to speak.

GET /api/character-live is the fast way to talk to a mod's character: a live voice line (Gemini Live), like the one
to the workers. Your microphone streams in and the character's voice streams back as they speak; see Speech.live."""
import asyncio
import base64
import binascii
import contextlib
import hashlib
import json
import os
import time

from aiohttp import WSMsgType, web
from google.genai import types

MODEL = os.getenv('OFFICE_TTS_MODEL', 'gemini-3.1-flash-tts-preview')
# Gemini's prebuilt voices.
VOICES = {'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
          'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar',
          'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'}
# Estimated USD per token (text in, audio out), at Gemini Flash TTS rates.
PRICE_IN, PRICE_OUT = .5 / 1e6, 10 / 1e6
HEADERS = {'Content-Type': 'application/octet-stream', 'X-Audio-Format': 's16le; rate=24000; channels=1'}
CHAT_MODEL = os.getenv('OFFICE_CHAT_MODEL', 'gemini-2.5-flash')
# Estimated USD per token for a chat turn (audio in priced for every prompt token, to err high; text out).
CHAT_PRICE_IN, CHAT_PRICE_OUT = 1 / 1e6, 2.5 / 1e6
CHAT_LIMIT = 1_500_000      # bytes of request: about 30 s of 16 kHz speech, base64-encoded
CHAT_INSTRUCTIONS = """

How to answer: put exactly what the person just said in "heard" (empty if it was only noise or not speech). Put your
spoken reply in "reply": one or two short sentences, said out loud straight away, so no lists, stage directions or emoji.
Leave "reply" empty if they were clearly talking to someone else, not to you. "mood" is how you say it."""


LIVE_INSTRUCTIONS = """

This is a live voice conversation: you hear the person through their microphone and answer out loud straight away, in
one or two short sentences, so no lists, stage directions or emoji. If they are clearly talking to someone else, stay
quiet. Messages in square brackets starting [HAPPENED] are things that just happened to you, or lines you just said
yourself; they are not the person speaking. Keep them in mind; you do not need to answer them."""
LIVE_MINUTES, LIVE_IDLE = 20, 240     # a character line closes after this long, or this many seconds without you speaking


def clip(value, limit):
    return ' '.join(str(value or '').split())[:limit]


async def read_body(request, limit):
    """The request body, up to limit bytes (past the office's small default limit, for a few seconds of audio)."""
    chunks, size = [], 0
    async for chunk in request.content.iter_chunked(65536):
        size += len(chunk)
        if size > limit:
            raise web.HTTPRequestEntityTooLarge(max_size=limit, actual_size=size)
        chunks.append(chunk)
    return b''.join(chunks)


class Speech:
    def __init__(self, client, credentials, refresh, cache, over_limit, record, off_reason='', token='', live_model=''):
        """client: the Gemini client (None when voice is off); credentials and refresh(): Google credentials to refresh
        before a call (None with an API key); cache: a folder for finished lines; over_limit(): True once today's voice
        budget is spent; record(usd): add to today's spend; token: the page token a live line must bring; live_model:
        the Gemini Live model (the workers' voice model)."""
        self.client, self.credentials, self.refresh = client, credentials, refresh
        self.cache, self.over_limit, self.record, self.off_reason = cache, over_limit, record, off_reason
        self.token, self.live_model = token, live_model
        self.gate = asyncio.Semaphore(3)          # live lines and prefetches share a few model calls at a time

    async def handle(self, request):
        body = await request.json()
        text = ' '.join(str(body.get('text', '')).split())[:400]
        style = ' '.join(str(body.get('style', '')).split())[:200]
        voice = body.get('voice') if body.get('voice') in VOICES else 'Enceladus'
        if not text:
            raise web.HTTPBadRequest(text='Nothing to say.')   # also how a mod checks that speech is here
        path = self.cache / f"{hashlib.sha1(f'{MODEL}|{voice}|{style}|{text}'.encode()).hexdigest()}.pcm"
        if path.is_file():
            return web.Response(body=path.read_bytes(), headers={**HEADERS, 'X-TTS-Cache': 'hit'})
        if not self.client:
            raise web.HTTPServiceUnavailable(text=self.off_reason or 'Voice is off.')
        if self.over_limit():
            raise web.HTTPTooManyRequests(text="Today's estimated voice spending limit has been reached.")
        if self.credentials and not self.credentials.valid:
            await asyncio.wait_for(asyncio.to_thread(self.refresh), timeout=30)
        config = types.GenerateContentConfig(response_modalities=['AUDIO'], speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))))
        response, chunks, usage, listening = None, [], None, True
        async with self.gate:
            try:
                stream = await self.client.aio.models.generate_content_stream(model=MODEL, contents=f'{style}: {text}' if style else text, config=config)
                async for chunk in stream:
                    usage = chunk.usage_metadata or usage
                    content = chunk.candidates[0].content if chunk.candidates else None
                    for part in (content.parts or []) if content else []:
                        data = part.inline_data.data if part.inline_data else None
                        if not data:
                            continue
                        chunks.append(data)
                        if response is None:            # the status is only sent once there is audio, so failures stay errors
                            response = web.StreamResponse(headers={**HEADERS, 'X-TTS-Cache': 'miss'})
                            await response.prepare(request)
                        if listening:
                            try:
                                await response.write(data)
                            except (ConnectionResetError, RuntimeError):
                                listening = False       # the page cut him off: keep going so the line is cached
            except Exception as error:
                if response is None:
                    raise web.HTTPBadGateway(text=f'Speech failed: {str(error)[:200]}')
            finally:
                if usage:
                    self.record((usage.prompt_token_count or 0) * PRICE_IN + (usage.candidates_token_count or 0) * PRICE_OUT)
        if not chunks:
            raise web.HTTPBadGateway(text='Speech came back empty.')
        with contextlib.suppress(OSError):
            self.cache.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix('.part')
            partial.write_bytes(b''.join(chunks))
            partial.replace(path)
        if listening:
            with contextlib.suppress(ConnectionResetError, RuntimeError):
                await response.write_eof()
        return response

    async def chat(self, request):
        """POST /api/chat {persona, memory, history: [{role: 'user' | 'character', text}], audio: base64 16 kHz mono WAV
        or text, moods: [...]} -> {heard, reply, mood}. An empty body answers 400, which is how a mod checks it is here."""
        try:
            body = json.loads(await read_body(request, CHAT_LIMIT) or b'{}')
        except ValueError:
            raise web.HTTPBadRequest(text='Not JSON.')
        text, audio = clip(body.get('text'), 500), None
        if body.get('audio'):
            try:
                audio = base64.b64decode(body['audio'], validate=True)
            except (binascii.Error, ValueError, TypeError):
                raise web.HTTPBadRequest(text='Audio is not base64.')
        if not text and not audio:
            raise web.HTTPBadRequest(text='Nothing said.')
        if not self.client:
            raise web.HTTPServiceUnavailable(text=self.off_reason or 'Voice is off.')
        if self.over_limit():
            raise web.HTTPTooManyRequests(text="Today's estimated voice spending limit has been reached.")
        moods = [clip(m, 20) for m in body.get('moods') or []][:12] or ['chat']
        history = [h for h in body.get('history') or [] if isinstance(h, dict)][-16:]
        try:
            answer = await self.converse(clip(body.get('persona'), 4000), str(body.get('memory') or '')[:8000], history,
                                         text, audio, moods)
        except asyncio.TimeoutError:
            raise web.HTTPGatewayTimeout(text='The reply took too long.')
        except Exception as error:
            raise web.HTTPBadGateway(text=f'Chat failed: {str(error)[:200]}')
        return web.json_response(answer)

    async def converse(self, persona, memory, history, text, audio, moods):
        """One turn: what was said (text, or WAV bytes) -> {heard, reply, mood}, in character, from the memory given."""
        if self.credentials and not self.credentials.valid:
            await asyncio.wait_for(asyncio.to_thread(self.refresh), timeout=30)
        turns = [types.Content(role='user' if h.get('role') == 'user' else 'model', parts=[types.Part(text=clip(h.get('text'), 500) or '...')])
                 for h in history]
        said = [types.Part.from_bytes(data=audio, mime_type='audio/wav'), types.Part(text='(That recording is what they just said to you.)')] if audio \
            else [types.Part(text=text)]
        turns.append(types.Content(role='user', parts=said))
        schema = types.Schema(type='OBJECT', required=['heard', 'reply', 'mood'], property_ordering=['heard', 'reply', 'mood'], properties={
            'heard': types.Schema(type='STRING'), 'reply': types.Schema(type='STRING'), 'mood': types.Schema(type='STRING', enum=moods)})
        config = types.GenerateContentConfig(
            system_instruction=f'{persona}\n\n{memory}{CHAT_INSTRUCTIONS}', response_mime_type='application/json', response_schema=schema,
            temperature=.9, max_output_tokens=400, thinking_config=types.ThinkingConfig(thinking_budget=0))
        async with self.gate:
            response = await asyncio.wait_for(self.client.aio.models.generate_content(model=CHAT_MODEL, contents=turns, config=config), timeout=25)
        usage = response.usage_metadata
        if usage:
            self.record((usage.prompt_token_count or 0) * CHAT_PRICE_IN + (usage.candidates_token_count or 0) * CHAT_PRICE_OUT)
        result = response.parsed if isinstance(response.parsed, dict) else json.loads(response.text or '{}')
        mood = result.get('mood') if result.get('mood') in moods else moods[0]
        return {'heard': clip(result.get('heard'), 500), 'reply': clip(result.get('reply'), 400), 'mood': mood}

    async def live(self, request):
        """GET /api/character-live?token=...: a live voice line to a mod's character, like the workers' one. The page
        sends {type: 'start', persona, memory, voice} first, then 16 kHz mono 16-bit PCM from the microphone as binary
        messages, all the time (the model hears when you start and stop talking). The character's voice comes back as
        24 kHz mono 16-bit PCM binary messages while it speaks, with JSON events: ready, transcript {role: 'user' |
        'character', text}, interrupted (you talked over it: drop what is queued), turn_complete, error, notice.
        {type: 'context', text} tells it what just happened without asking for an answer; {type: 'stop'} hangs up."""
        if not self.token or request.query.get('token') != self.token:
            raise web.HTTPForbidden()
        ws = web.WebSocketResponse(max_msg_size=262144, heartbeat=20)
        await ws.prepare(request)

        async def event(kind, **kwargs):
            if not ws.closed:
                with contextlib.suppress(ConnectionResetError, RuntimeError):
                    await ws.send_json(dict(type=kind, **kwargs))

        try:
            if not self.client or not self.live_model:
                await event('error', text=self.off_reason or 'Voice is off.')
                return ws
            if self.over_limit():
                await event('error', text="Today's estimated voice spending limit has been reached.")
                return ws
            first = await ws.receive(timeout=20)
            start = json.loads(first.data) if first.type == WSMsgType.TEXT else {}
            if start.get('type') != 'start':
                await event('error', text='Send {type: "start", persona, memory, voice} first.')
                return ws
            voice = start.get('voice') if start.get('voice') in VOICES else 'Enceladus'
            prompt = f"{clip(start.get('persona'), 4000)}\n\n{str(start.get('memory') or '')[:8000]}{LIVE_INSTRUCTIONS}"
            config = types.LiveConnectConfig(
                response_modalities=['AUDIO'], system_instruction=prompt,
                speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
                input_audio_transcription=types.AudioTranscriptionConfig(), output_audio_transcription=types.AudioTranscriptionConfig(),
                realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(silence_duration_ms=450)),
                proactivity=types.ProactivityConfig(proactive_audio=True),
                context_window_compression=types.ContextWindowCompressionConfig(trigger_tokens=16000, sliding_window=types.SlidingWindow(target_tokens=8000)))
            if self.credentials and not self.credentials.valid:
                await asyncio.wait_for(asyncio.to_thread(self.refresh), timeout=30)
            state = dict(usd=0.0, recorded=0.0, audio_in=0, audio_out=0, user='', bot='', started=time.monotonic(), heard=time.monotonic())
            async with self.client.aio.live.connect(model=self.live_model, config=config) as session:
                await event('ready', model=self.live_model)

                def account():
                    # Conservative all-audio rates, as for the workers; an estimate, not a billing cap.
                    state['usd'] = max(state['usd'], state['audio_in'] / 32000 / 60 * .005 + state['audio_out'] / 48000 / 60 * .018)
                    delta = state['usd'] - state['recorded']
                    if delta > 0:
                        self.record(delta)
                        state['recorded'] = state['usd']

                async def receive():
                    while not ws.closed:
                        async for msg in session.receive():
                            content = msg.server_content
                            if content:
                                if content.interrupted:
                                    await event('interrupted')
                                if content.input_transcription and content.input_transcription.text:
                                    state['heard'] = time.monotonic()
                                    state['user'] += content.input_transcription.text
                                    await event('transcript', role='user', text=state['user'])
                                if content.output_transcription and content.output_transcription.text:
                                    state['bot'] += content.output_transcription.text
                                    await event('transcript', role='character', text=state['bot'])
                                if content.model_turn:
                                    for part in content.model_turn.parts:
                                        if part.inline_data and part.inline_data.data and not ws.closed:
                                            state['audio_out'] += len(part.inline_data.data)
                                            await ws.send_bytes(part.inline_data.data)
                                if content.turn_complete:
                                    await event('turn_complete', user=state['user'].strip(), character=state['bot'].strip())
                                    state['user'] = state['bot'] = ''
                            if msg.usage_metadata:
                                usage = msg.usage_metadata
                                state['usd'] += (usage.prompt_token_count or 0) * 3 / 1e6 + (usage.response_token_count or 0) * 12 / 1e6
                                account()
                                if self.over_limit():
                                    await event('notice', text='Estimated voice spending limit reached. Voice paused.')
                                    await ws.close()
                                    return

                async def watchdog():
                    while not ws.closed:
                        await asyncio.sleep(2)
                        now = time.monotonic()
                        if now - state['started'] > LIVE_MINUTES * 60 or now - state['heard'] > LIVE_IDLE:
                            await event('notice', text='Live voice closed after its time or idle limit.', reason='idle')
                            await ws.close()
                            return

                tasks = [asyncio.create_task(receive()), asyncio.create_task(watchdog())]

                def failed(task):
                    if not task.cancelled() and task.exception():
                        asyncio.create_task(event('error', text=str(task.exception())[:400]))
                        asyncio.create_task(ws.close())
                tasks[0].add_done_callback(failed)
                try:
                    async for msg in ws:
                        if msg.type == WSMsgType.BINARY:
                            state['audio_in'] += len(msg.data)
                            await session.send_realtime_input(audio=types.Blob(data=msg.data, mime_type='audio/pcm;rate=16000'))
                        elif msg.type == WSMsgType.TEXT:
                            body = json.loads(msg.data)
                            if body.get('type') == 'context' and body.get('text'):
                                with contextlib.suppress(Exception):
                                    await session.send_client_content(turns=types.Content(role='user', parts=[types.Part(
                                        text=f"[HAPPENED] {clip(body['text'], 400)}")]), turn_complete=False)
                            elif body.get('type') == 'stop':
                                break
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    account()
        except Exception as error:
            await event('error', text=f'Live voice failed: {str(error)[:300]}')
        finally:
            if not ws.closed:
                await ws.close()
        return ws
