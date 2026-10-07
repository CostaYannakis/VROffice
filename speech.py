"""Text to speech for office mods (the massage client, say): POST /api/tts {text, voice, style} speaks a line in one of
Gemini's voices and streams it back as raw 24 kHz mono 16-bit little-endian PCM while it is made. Every finished line is
kept in a disk cache, so a mod can say (or prefetch) the same line again for free and instantly. The spend counts
towards the office's daily voice limit.

POST /api/chat lets you talk to a mod's character: it takes what you said (a short WAV recording, or text), who the
character is and what they remember, and returns what Gemini heard and the character's reply, for the mod to speak."""
import asyncio
import base64
import binascii
import contextlib
import hashlib
import json
import os

from aiohttp import web
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
    def __init__(self, client, credentials, refresh, cache, over_limit, record, off_reason=''):
        """client: the Gemini client (None when voice is off); credentials and refresh(): Google credentials to refresh
        before a call (None with an API key); cache: a folder for finished lines; over_limit(): True once today's voice
        budget is spent; record(usd): add to today's spend."""
        self.client, self.credentials, self.refresh = client, credentials, refresh
        self.cache, self.over_limit, self.record, self.off_reason = cache, over_limit, record, off_reason
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
